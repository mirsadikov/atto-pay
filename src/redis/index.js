const { createClient } = require('redis');

const redisClient = createClient({
  url: process.env.REDIS_URL,
  socket: {
    tls: process.env.REDIS_TLS === 'true',
  },
});

redisClient.on('error', (err) => console.error(err));

redisClient.connect();

module.exports = redisClient;
//redisClient.disconnect();
