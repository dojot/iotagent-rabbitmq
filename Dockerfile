FROM node:8

WORKDIR /opt/iotagent-rabbitmq

COPY . .
RUN npm install && npm run-script build

RUN chmod +x entrypoint.sh

ENTRYPOINT ["./entrypoint.sh"]
