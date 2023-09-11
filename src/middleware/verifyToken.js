const moment = require('moment');
const redis = require('../redis');

async function verifyToken(req) {
  const token = req.headers.authorization;
  if (!token) {
    throw new Error('Missing auth token');
  }

  // check if token exists in redis
  const details = JSON.parse(await redis.hGet('tokens', token));
  if (!details) {
    throw new Error('Invalid token');
  }

  // check if token is expired
  if (details.expiresAt < moment().valueOf()) {
    throw new Error('Token expired');
  }

  return details.id;
}

module.exports = verifyToken;
