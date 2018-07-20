FROM node:8

WORKDIR /opt/iotagent-rabbitmq

COPY entrypoint.sh .
RUN chmod +x entrypoint.sh

COPY package.json .
RUN npm install

COPY tsconfig.json .
COPY src ./src

RUN npm run-script build

ENTRYPOINT ["./entrypoint.sh"]
