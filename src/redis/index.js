const { createClient } = require('redis');

const redisClient = createClient({
  url: `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`,
});

redisClient.on('error', (err) => console.log('Redis Client Error', err));

redisClient.connect();

function set(key, val) {
  redisClient.set(key, val);
}

function get(key) {
  return redisClient.get(key).then((val) => val);
}

function setex(key, val, time) {
  redisClient.setEx(key, time, val);
}

module.exports = { get, set, setex };
//redisClient.disconnect();
