const fetchDB = require('../postgres');
const { customersQuery } = require('../postgres/queries');
const { get } = require('../redis');

async function verifyToken(req, res, next) {
  try {
    const token = req.headers.authorization;
    if (!token) throw new Error('Missing auth token');

    // check if token exists in redis
    const userId = await get(`token_${token}`);
    if (!userId) throw new Error('Expired or invalid token');

    // check if user exists in db
    const user = await fetchDB(customersQuery.getOneById, userId);

    // if user does not exist in db, throw error
    if (user.rows.length === 0) {
      res.status(404);
      next(new Error('User not found'));
    }

    req.user = user.rows[0];
    next();
  } catch (err) {
    res.status(401);
    next(err);
  }
}

module.exports = verifyToken;
