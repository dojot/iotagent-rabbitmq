import util = require("util");
import iotagent = require('dojot-iotagent');
import bodyParser = require('body-parser');
import { CacheHandler } from "./cache";
var amqp = require('amqplib/callback_api');

var config:any = {};

config.RABBITMQ_HOST = process.env.RABBITMQ_HOST || "rabbitmq-for-iotagent";
config.RABBITMQ_PORT = process.env.RABBITMQ_PORT || 5672;
config.RABBITMQ_DEFAULT_USER = process.env.RABBITMQ_DEFAULT_USER || "test";
config.RABBITMQ_DEFAULT_PASS = process.env.RABBITMQ_DEFAULT_PASS || "test";
config.RABBITMQ_DEFAULT_VHOST = process.env.RABBITMQ_DEFAULT_VHOST || "/";
config.RABBITMQ_INBOUND_EXCHANGE = process.env.RABBITMQ_INBOUND_EXCHANGE || "inbound.dojot.exchange"
config.RABBITMQ_INBOUND_QUEUE = process.env.RABBITMQ_INBOUND_QUEUE || "inbound.dojot.queue"
config.RABBITMQ_OUTBOUND_EXCHANGE = process.env.RABBITMQ_OUTBOUND_EXCHANGE || "outbound.dojot.exchange"

/**
 * RabbitMQ IoT Agent Class
 */
class Agent {

  // IoTAgent lib
  iota: iotagent.IoTAgent;

  // amqp's routing key and dojot's device id mapping
  cache: CacheHandler;

  // it is recommended to have one connection per consumer/producer
  consumerConnection: any;
  producerConnection: any;
  producerChannel: any;
  isProducerReady: boolean;

  isConsumerReconnecting: boolean;
  isProducerReconnecting: boolean;

  constructor() {

    this.cache = new CacheHandler();

    this.isProducerReady = false;

    this.isConsumerReconnecting = false;
    this.isProducerReconnecting = false;

    this.iota = new iotagent.IoTAgent();
    this.iota.init();
  }

  get_device_amqp_routing_key(device_info: any) {
    for (let template_id of device_info.templates) {
      for (let attr of device_info.attrs[template_id]) {
        if (attr.label !== undefined && attr.label === 'device_amqp_routing_key') {
          if (attr.static_value !== undefined) {
            return attr.static_value;
          }
        }
      }
    }
    return '';
  }

  start_amqp_consumer_connection() {
    let connection_url = "amqp://" + config.RABBITMQ_DEFAULT_USER + ":" + config.RABBITMQ_DEFAULT_PASS + "@" + config.RABBITMQ_HOST + ":" + config.RABBITMQ_PORT + "/" + config.RABBITMQ_DEFAULT_VHOST + "?heartbeat=30";

    console.log("[AMQP-Consumer] connection url = ", connection_url);

    try {
      amqp.connect(connection_url, (err: any, conn: any) => {
        if (err) {
          console.error("[AMQP-Consumer]", err.message);
          this.reconnect_consumer();
          return;
        }
        conn.on("error", function(err: any) {
          console.error("[AMQP-Consumer] conn error", err.message);
        });
        conn.on("close", () => {
          console.error("[AMQP-Consumer] Closing connection");
          this.reconnect_consumer();
          return;
        });

        console.log("[AMQP-Consumer] connected");
        this.consumerConnection = conn;

        this.start_consumer_binding();
      });
    } catch (e) {
      console.log("connect error: %s", e);
      console.error("[AMQP-Consumer] reconnecting");
      this.reconnect_consumer();
    }
  }

  start_amqp_producer_connection() {
    let connection_url = "amqp://" + config.RABBITMQ_DEFAULT_USER + ":" + config.RABBITMQ_DEFAULT_PASS + "@" + config.RABBITMQ_HOST + ":" + config.RABBITMQ_PORT + "/" + config.RABBITMQ_DEFAULT_VHOST + "?heartbeat=30";

    console.log("[AMQP-Producer] connection url = ", connection_url);

    try {
      amqp.connect(connection_url, (err: any, conn: any) => {
        if (err) {
          console.error("[AMQP-Producer]", err.message);
          this.isProducerReady = false;
          this.reconnect_producer();
          return;
        }
        conn.on("error", (err: any) => {
          this.isProducerReady = false;
          console.error("[AMQP-Producer] conn error", err.message);
        });
        conn.on("close", () => {
          console.error("[AMQP-Producer] Closing connection");
          this.isProducerReady = false;
          this.reconnect_producer();
          return;
        });

        console.log("[AMQP-Producer] connected");
        this.producerConnection = conn;

        this.start_producer_binding();
      });
    } catch (e) {
      this.isProducerReady = false;
      console.log("connect error: %s", e);
      console.error("[AMQP-Producer] reconnecting");
      this.reconnect_producer();
    }
  }

  start_consumer_binding() {
    try {
      this.consumerConnection.createChannel((err: any, ch: any) => {
        if (this.consumerConnCloseOnErr(err)) {
          return;
        }
        ch.on("error", function(err: any) {
          console.error("[AMQP-Consumer] channel error", err.message);
        });
        ch.on("close", () => {
          console.log("[AMQP-Consumer] channel closed");
          if (this.consumerConnCloseOnErr("Channel closed")) {
            return;
          }
        });
        ch.assertExchange(config.RABBITMQ_INBOUND_EXCHANGE, 'topic', {durable: true});
        ch.assertQueue(config.RABBITMQ_INBOUND_QUEUE, {autoDelete: false, durable: true, arguments: {"x-message-ttl": 20000, "x-max-length": 100000, "x-max-length-bytes": 512000000, "x-overflow": "reject-publish"}}, (err: any, q: any) => {
          if (this.consumerConnCloseOnErr(err)) {
            return;
          }
          ch.bindQueue(config.RABBITMQ_INBOUND_QUEUE, config.RABBITMQ_INBOUND_EXCHANGE, "#");
          ch.consume(config.RABBITMQ_INBOUND_QUEUE, (msg: any) => {
            try {
              this.handle_data(msg.fields.routingKey, msg.content);
            } catch (e) {
              console.log("Exception: ", e);
            }
          }, {noAck: true});
        });
      });
    } catch (e) {
      console.log("[AMQP-Consumer] exception: %s", e);
    }
  }

  start_producer_binding() {
    try {
      this.producerConnection.createChannel((err: any, ch: any) => {
        if (this.producerConnCloseOnErr(err)) {
          this.isProducerReady = false;
          return;
        }
        ch.on("error", (err: any) => {
          this.isProducerReady = false;
          console.error("[AMQP-Producer] channel error", err.message);
        });
        ch.on("close", () => {
          this.isProducerReady = false;
          console.log("[AMQP-Producer] channel closed");
          if (this.producerConnCloseOnErr("Channel closed")) {
            return;
          }
        });
        ch.assertExchange(config.RABBITMQ_OUTBOUND_EXCHANGE, 'direct', {durable: true});
        this.producerChannel = ch;
        this.isProducerReady = true;
      });
    } catch (e) {
      this.isProducerReady = false;
      console.log("[AMQP-Producer] exception: %s", e);
    }
  }

  reconnect_consumer() {
    var that = this;
    setTimeout(() => {
        console.log("[AMQP-Consumer] reconnecting...");
        this.start_amqp_consumer_connection();
    }, 1000);
  }

  reconnect_consumer_channel() {
    var that = this;
    setTimeout(() => {
        console.log("[AMQP-Consumer] reconnecting channel...");
        this.start_producer_binding();
    }, 1000);
  }

  reconnect_producer() {
    var that = this;
    setTimeout(() => {
        console.log("[AMQP-Producer] reconnecting...");
        this.start_amqp_producer_connection();
    }, 1000);
  }

  consumerConnCloseOnErr(err: any) {
    if (!err) return false;
    console.error("[AMQP-Consumer] error", err);
    this.consumerConnection.close();
    return true;
  }

  producerConnCloseOnErr(err: any) {
    if (!err) return false;
    console.error("[AMQP-Producer] error", err);
    this.producerConnection.close();
    return true;
  }

  publish(routingKey: string, msg: string) {
      if (this.isProducerReady) {
          this.producerChannel.publish(config.RABBITMQ_OUTBOUND_EXCHANGE, routingKey, new Buffer(msg));
      } else {
          console.log("[AMQP-Producer] is not ready to publish messages");
      }
  }

  start_rabbitmq_connection() {
    console.log("Starting AMQP Connections...")  ;
    console.log("Host = %s", config.RABBITMQ_HOST);
    console.log("Port = %d", config.RABBITMQ_PORT);
    console.log("User = %s", config.RABBITMQ_DEFAULT_USER);
    console.log("Pass = %s", config.RABBITMQ_DEFAULT_PASS);
    console.log("Virtual host = %s", config.RABBITMQ_DEFAULT_VHOST);
    console.log("inbound exchange = %s", config.RABBITMQ_INBOUND_EXCHANGE);
    console.log("inbound queue = %s", config.RABBITMQ_INBOUND_QUEUE);
    console.log("outbound exchange = %s", config.RABBITMQ_OUTBOUND_EXCHANGE);

    this.start_amqp_consumer_connection();
    this.start_amqp_producer_connection();
  }

  start() {
    this.start_rabbitmq_connection();

    this.iota.listTenants()
      .then((tenants: any) => {
        for (let t of tenants) {
          this.iota.listDevices(t, {}).then((devices_info: any) => {
            console.log('Got device list for [%s]', t, devices_info);
            for (let device_id of devices_info) {
              this.iota.getDevice(device_id, t).then((device_info: any) => {
                console.log(' --- Device info (%s)\n', device_id, device_info);
                console.log(util.inspect(device_info, { depth: null}));
                let device_amqp_routing_key = this.get_device_amqp_routing_key(device_info);
                if (device_amqp_routing_key !== '') {
                  this.cache.correlate_dojot_and_device_amqp_routing_key(device_id, device_amqp_routing_key);
                }
              })
            }
          })
        }
      })
    .catch((error: any) => {console.error(error)});

    this.iota.on('device.create', (event: any) => { this.on_create_device(event) });
    this.iota.on('device.update', (event: any) => { this.on_update_device(event) });
    this.iota.on('device.remove', (event: any) => { this.on_delete_device(event) });
  }

  handle_data(routingKey: string, payload: Buffer) {
    console.log("routingKey[%s] -> payload[%s]", routingKey, payload.toString());

    // get device from cache
    let dojot_device_id = this.cache.get_dojot_device_id(routingKey);

    console.log("Retrieving dojot device id [%s] <-> [%s] from device amqp routing key", dojot_device_id, routingKey);

    // TODO: some Dojot necessary steps:
    // let timestamp = new Date(timestamp_in_payload_var*1000).toISOString();
    // this.iota.listTenants()
    //   .then((tenants: any) => {
    //     for (let t of tenants) {
    //       this.iota.updateAttrs(dojot_device_id, t, body, {});
    //     }
    //   })
    // .catch((error: any) => {console.error(error)});
  }

  on_create_device(event: any) {
    console.log('device [%s] created', event.data.id);

    let device_amqp_routing_key = this.get_device_amqp_routing_key(event.data);
    if (device_amqp_routing_key !== '') {
      this.cache.correlate_dojot_and_device_amqp_routing_key(event.data.id, device_amqp_routing_key);
    }
  }

  on_update_device(event: any) {
    console.log('device [%s] updated', event.data.id);

    let device_amqp_routing_key = this.get_device_amqp_routing_key(event.data);
    if (device_amqp_routing_key !== '') {
      this.cache.correlate_dojot_and_device_amqp_routing_key(event.data.id, device_amqp_routing_key);
    }
  }

  on_delete_device(event: any) {
    console.log('device [%s] removed', event.data.id);

    let device_amqp_routing_key = this.get_device_amqp_routing_key(event.data);
    if (device_amqp_routing_key !== '') {
      this.cache.remove_correlation_dojot_and_device_amqp_routing_key(event.data.id, device_amqp_routing_key);
    }
  }

}

export { Agent };
