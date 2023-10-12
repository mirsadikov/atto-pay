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

  execute(promise, cb) {
    cb = cb || (() => {});

    return promise
      .then((res) => {
        cb(null, res);
        return res;
      })
      .catch((err) => cb(err));
  }

  hSet(key, field, value, cb) {
    return this.execute(this.client.hSet(key, field, value), cb);
  }

  hGet(key, field, cb) {
    return this.execute(this.client.hGet(key, field), cb);
  }

  hDel(key, field, cb) {
    return this.execute(this.client.hDel(key, field), cb);
  }

  flushall(cb) {
    return this.execute(this.client.flushAll(), cb);
  }

  disconnect() {
    this.client.quit();
  }
}

const redisClient = new RedisClient();

module.exports = redisClient;
