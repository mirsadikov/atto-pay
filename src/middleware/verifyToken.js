const fetchDB = require('../postgres');
const { customersQuery } = require('../postgres/queries');
const redis = require('../redis');

async function verifyToken(req, res) {
  const token = req.headers.authorization;
  if (!token) {
    res.status(401);
    throw new Error('Missing auth token');
  }

  // check if token exists in redis
  const details = JSON.parse(await redis.hGet('tokens', token));
  if (!details) {
    res.status(401);
    throw new Error('Invalid token');
  }

  // check if token is expired
  if (details.expiresAt < Date.now()) {
    console.log(details.expiresAt, Date.now());
    res.status(401);
    throw new Error('Token expired');
  }

  // check if user exists in db
  const user = await fetchDB(customersQuery.getOneById, details.id);

  // if user does not exist in db, throw error
  if (user.rows.length === 0) {
    res.status(404);
    throw new Error('User not found');
  }

  return user.rows[0];
}

module.exports = verifyToken;
