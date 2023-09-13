const async = require('async');
const v4 = require('uuid').v4;
const moment = require('moment');
const bcrypt = require('bcrypt');
const fetchDB = require('../postgres');
const redis = require('../redis');
const { customersQuery } = require('../postgres/queries');
const verifyToken = require('../middleware/verifyToken');
const LIVR = require('../utils/livr');
const ValidationError = require('../errors/ValidationError');
const CustomError = require('../errors/CustomError');

function getCustomerProfile(req, res, next) {
  async.waterfall(
    [
      (cb) => {
        verifyToken(req, (err, userId) => {
          if (err) return cb(err);
          cb(null, userId);
        });
      },
      (userId, cb) => {
        fetchDB(customersQuery.getOneById, [userId], (err, result) => {
          if (err) return cb(err);
          if (result.rows.length === 0) return cb(new CustomError('USER_NOT_FOUND'));

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
        const { name, phone, password } = req.body;

        const validator = new LIVR.Validator({
          name: ['trim', 'string', 'required'],
          phone: ['trim', 'positive_integer', 'required'],
          password: ['trim', 'required', { min_length: 6 }, 'alphanumeric'],
        });

        const validData = validator.validate({ name, phone, password });
        if (!validData) return cb(new ValidationError(validator.getErrors()));

        cb(null, validData);
      },
      // if user exists, return error
      (data, cb) => {
        fetchDB(customersQuery.getOneByPhone, [data.phone], (err, result) => {
          if (err) return cb(err);
          if (result.rows.length > 0) return cb(new CustomError('USER_EXISTS'));

          cb(null, data);
        });
      },
      // if new user, create user
      (data, cb) => {
        const { name, phone, password } = data;
        const hashedPassword = bcrypt.hashSync(password, 10);

        fetchDB(customersQuery.create, [name, phone, hashedPassword], (err, result) => {
          if (err) return cb(err);

          const user = result.rows[0];
          delete user.hashed_password;
          res.status(201).json(user);
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
        const { phone, password } = req.body;

        const validator = new LIVR.Validator({
          phone: ['trim', 'positive_integer', 'required'],
          password: ['trim', 'required'],
        });

        const validData = validator.validate({ phone, password });
        if (!validData) return cb(new ValidationError(validator.getErrors()));

        cb(null, validData);
      },
      // if user not exists, return error
      (data, cb) => {
        fetchDB(customersQuery.getOneByPhone, [data.phone], (err, result) => {
          if (err) return cb(err);
          if (result.rows.length === 0) return cb(new CustomError('USER_NOT_FOUND'));

          cb(null, data, result.rows[0]);
        });
      },
      // if user exists, check password
      (inputs, user, cb) => {
        const { password: hashedPassword } = inputs;

        const isPasswordCorrect = bcrypt.compareSync(hashedPassword, user.hashed_password);
        if (!isPasswordCorrect) return cb(new CustomError('WRONG_PASSWORD'));

        cb(null, user);
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

function updateCustomer(req, res, next) {
  async.waterfall(
    [
      (cb) => {
        verifyToken(req, (err, userId) => {
          if (err) return cb(err);
          cb(null, userId);
        });
      },
      // validate data
      (userId, cb) => {
        const { name, password } = req.body;

        const validator = new LIVR.Validator({
          name: ['trim', 'string'],
          password: ['trim', { min_length: 6 }, 'alphanumeric'],
        });

        const validData = validator.validate({ name, password });
        if (!validData) return cb(new ValidationError(validator.getErrors()));

        cb(null, userId, validData);
      },
      // get user
      (userId, data, cb) => {
        fetchDB(customersQuery.getOneById, [userId], (err, result) => {
          if (err) return cb(err);
          if (result.rows.length === 0) return cb(new CustomError('USER_NOT_FOUND'));
          cb(null, result.rows[0], data);
        });
      },
      // update user
      (user, data, cb) => {
        const { name, password } = data;
        const hashedPassword = password ? bcrypt.hashSync(password, 10) : user.hashed_password;
        const newName = name || user.name;

        fetchDB(customersQuery.update, [newName, hashedPassword, user.id], (err, result) => {
          if (err) return cb(err);

          const user = result.rows[0];
          delete user.hashed_password;
          res.status(200).json({
            success: true,
            details: user,
          });

          cb(null);
        });
      },
    ],
    (err) => err && next(err)
  );
}

module.exports = {
  getCustomerProfile,
  customerRegister,
  customerLogin,
  updateCustomer,
};
