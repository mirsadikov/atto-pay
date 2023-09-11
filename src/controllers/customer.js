const async = require('async');
const v4 = require('uuid').v4;
const moment = require('moment');
const LIVR = require('livr');
const fetchDB = require('../postgres');
const redis = require('../redis');
const { customersQuery } = require('../postgres/queries');
const verifyToken = require('../middleware/verifyToken');
const ValidatorError = require('../errors/ValidatorError');

function getCustomerProfile(req, res, next) {
  async.waterfall(
    [
      (cb) => {
        verifyToken(req)
          .then((id) => {
            cb(null, id);
          })
          .catch((err) => {
            res.status(401);
            cb(err);
          });
      },
      (userId, cb) => {
        fetchDB(customersQuery.getOneById, [userId], (err, result) => {
          if (err) return cb(err);

          if (result.rows.length === 0) {
            res.status(404);
            return cb(new Error('User does not exist'));
          }

          const user = result.rows[0];
          res.status(200).json(user);
        });
      },
    ],
    (err) => err && next(err)
  );
}

function customerRegister(req, res, next) {
  async.waterfall(
    [
      // validate data
      (cb) => {
        const { name, phone } = req.body;

        const validator = new LIVR.Validator({
          name: ['trim', 'string', 'required'],
          phone: ['trim', 'integer', 'required'],
        });

        const validData = validator.validate({ name, phone });

        if (!validData) {
          res.status(400);
          return cb(new ValidatorError('Invalid input', validator.getErrors()));
        }

        cb(null, validData);
      },
      // if user exists, return error
      (data, cb) => {
        fetchDB(customersQuery.getOneByPhone, [data.phone], (err, result) => {
          if (err) return cb(err);

          if (result.rows.length > 0) {
            res.status(400);
            return cb(new Error('User already exists'));
          }

          cb(null, data);
        });
      },
      // if new user, create user
      ({ name, phone }, cb) => {
        fetchDB(customersQuery.create, [name, phone], (err, result) => {
          if (err) return cb(err);

          res.status(201).json(result.rows[0]);
          cb(null);
        });
      },
    ],
    (err) => err && next(err)
  );
}

function customerLogin(req, res, next) {
  async.waterfall(
    [
      // validate data
      (cb) => {
        const { phone } = req.body;

        const validator = new LIVR.Validator({
          phone: ['trim', 'integer', 'required'],
        });

        const validData = validator.validate({ phone });

        if (!validData) {
          res.status(400);
          return cb(new ValidatorError('Invalid input', validator.getErrors()));
        }

        cb(null, validData);
      },
      // if user not exists, return error
      (data, cb) => {
        fetchDB(customersQuery.getOneByPhone, [data.phone], (err, result) => {
          if (err) return cb(err);

          if (result.rows.length === 0) {
            res.status(404);
            return cb(new Error('User does not exist'));
          }

          cb(null, result.rows[0]);
        });
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
