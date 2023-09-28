const { createClient } = require('redis');

class RedisClient {
  constructor() {
    this.client = createClient({
      url: process.env.REDIS_URL,
      socket: {
        tls: process.env.REDIS_TLS === 'true',
      },
    });

    this.client.on('error', (err) => console.error(err));
    this.client.connect();
  }

  hSet(key, field, value) {
    return this.client.hSet(key, field, value);
  }

  hGet(key, field) {
    return this.client.hGet(key, field);
  }

  hDel(key, field) {
    return this.client.hDel(key, field);
  }

  disconnect() {
    this.client.quit();
  }
}

const redisClient = new RedisClient();

module.exports = redisClient;
