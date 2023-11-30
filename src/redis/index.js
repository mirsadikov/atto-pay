const { createClient } = require('redis');
const { REDIS_URL, REDIS_TLS } = require('../config/secrets');

class RedisClient {
  constructor() {
    this.client = createClient({
      url: REDIS_URL,
      socket: {
        tls: REDIS_TLS === 'true',
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

  hGetAll(key, cb) {
    return this.execute(this.client.hGetAll(key), cb);
  }

  get(key, cb) {
    return this.execute(this.client.get(key), cb);
  }

  set(key, value, expire, cb) {
    if (typeof expire === 'function') {
      cb = expire;
      expire = null;
    }

    const promise = expire
      ? this.client.set(key, value, 'EX', expire)
      : this.client.set(key, value);

    return this.execute(promise, cb);
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
