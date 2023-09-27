const moment = require('moment');
const redis = require('../redis');
const CustomError = require('../errors/CustomError');

async function verifyToken(req, role,cb) {
  const token = req.headers.authorization;
  if (!token) return cb(new CustomError('MISSING_TOKEN'));

  // check if token exists in redis
  const details = JSON.parse(await redis.hGet('tokens', token));
  if (!details) return cb(new CustomError('INVALID_TOKEN'));

  // check if token is expired
  if (details.expiresAt < moment().valueOf()) return cb(new CustomError('EXPIRED_TOKEN'));
  if(details.role!==role) return cb(new CustomError('NOT_ALLOWED'))

  return cb(null, details.id);
}

module.exports = verifyToken;
