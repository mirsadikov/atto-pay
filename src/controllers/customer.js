const async = require('async');
const v4 = require('uuid').v4;
const moment = require('moment');
const fetchDB = require('../postgres');
const redis = require('../redis');
const { customersQuery } = require('../postgres/queries');
const verifyToken = require('../middleware/verifyToken');

function getCustomerProfile(req, res, next) {
  async.waterfall(
    [
      (cb) => {
        verifyToken(req, res)
          .then(({ id }) => {
            cb(null, id);
          })
          .catch((err) => cb(err));
      },
      (userId, cb) => {
        fetchDB(customersQuery.getOneById, userId)
          .then((result) => {
            if (result.rows.length === 0) {
              res.status(404);
              cb(new Error('User does not exist'));
            }

            const user = result.rows[0];
            res.status(200).json(user);
          })
          .catch((err) => cb(err));
      },
    ],
    (err) => err && next(err)
  );
}

function customerRegister(req, res, next) {
  const { name, phone } = req.body;

  if (!name || !phone || !name.trim() || !phone.trim()) {
    res.status(400);
    throw new Error('Name or phone is invalid');
  }

  async.waterfall(
    [
      // if user exists, return error
      (cb) => {
        fetchDB(customersQuery.getOneByPhone, phone)
          .then((result) => {
            if (result.rows.length > 0) {
              res.status(400);
              cb(new Error('User already exists'));
            } else cb(null);
          })
          .catch((err) => cb(err));
      },
      // if new user, create user
      (cb) => {
        fetchDB(customersQuery.create, name, phone)
          .then((result) => {
            res.status(201).json(result.rows[0]);
            cb(null);
          })
          .catch((err) => cb(err));
      },
    ],
    (err) => err && next(err)
  );
}

function customerLogin(req, res, next) {
  const { phone } = req.body;

  if (!phone || !phone.trim()) {
    res.status(400);
    throw new Error('Phone is invalid');
  }

  async.waterfall(
    [
      // if user not exists, return error
      (cb) => {
        fetchDB(customersQuery.getOneByPhone, phone)
          .then((result) => {
            if (result.rows.length === 0) {
              res.status(404);
              cb(new Error('User does not exist'));
            } else cb(null, result.rows[0]);
          })
          .catch((err) => cb(err));
      },
      // delete old token from redis if exists
      (user, cb) => {
        redis.hGet('users', user.id).then((oldToken) => {
          if (oldToken) redis.hDel('tokens', oldToken);
          cb(null, user);
        });
      },
      // save and return new token
      (user, cb) => {
        const token = v4();
        redis.hSet('users', user.id, token);
        redis.hSet(
          'tokens',
          token,
          JSON.stringify({ id: user.id, expiresAt: moment().add(1, 'hour').valueOf() })
        );
        res.status(200).json({ token });
        cb(null);
      },
    ],
    (err) => err && next(err)
  );
}

module.exports = {
  getCustomerProfile,
  customerRegister,
  customerLogin,
};
