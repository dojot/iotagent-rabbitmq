'use strict';

var config = {};

config.RABBITMQ_HOST = process.env.RABBITMQ_HOST || "rabbitmq-iotagent"
config.RABBITMQ_PORT = process.env.RABBITMQ_PORT || 5672
config.RABBITMQ_USER = process.env.RABBITMQ_DEFAULT_USER || "guest"
config.RABBITMQ_PASS = process.env.RABBITMQ_DEFAULT_PASS || "guest"
config.RABBITMQ_VHOST = process.env.RABBITMQ_DEFAULT_VHOST || "/"

module.exports = config;
