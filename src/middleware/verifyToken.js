const jwt = require('jsonwebtoken');
const { get } = require('../redis');

async function verifyToken(req, res, next) {
  try {
    const token = req.headers.authorization;
    if (!token) throw new Error('Missing auth token');

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const redisToken = await get(decoded.id);

    if (redisToken !== token) throw new Error('Expired token');
    
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401);
    next(err);
  }
}

module.exports = verifyToken;
