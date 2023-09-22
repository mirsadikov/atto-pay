const bcrypt = require('bcrypt');
const async = require('async');
const moment = require('moment');
const { v4 } = require('uuid');
const LIVR = require('../utils/livr');
const fetchDB = require('../postgres');
const redis = require('../redis');
const { merchantsQuery } = require('../postgres/queries');
const ValidationError = require('../errors/ValidationError');
const CustomError = require('../errors/CustomError');
const verifyToken = require('../middleware/verifyToken');

function registerMerchant(req, res, next) {
  let inputs;
  let merchant;

  async.waterfall(
    [
      // validate data
      (cb) => {
        const { name, email, password } = req.body;

        const validator = new LIVR.Validator({
          name: ['trim', 'string', 'required', { min_length: 2 }, { max_length: 30 }],
          email: ['trim', 'email', 'required'],
          password: ['trim', 'required', { min_length: 7 }, 'alphanumeric'],
        });

        const validData = validator.validate({
          name,
          email,
          password,
        });
        if (!validData) return cb(new ValidationError(validator.getErrors()));

        inputs = validData;
        cb(null);
      },
      // if merchant exists, return error
      (cb) => {
        fetchDB(merchantsQuery.getOneByEmail, [inputs.email], (err, result) => {
          if (err) return cb(err);
          if (result.rows.length > 0) return cb(new CustomError('EMAIL_TAKEN'));

          cb(null);
        });
      },
      // create merchant
      (cb) => {
        const { name, email, password } = inputs;
        const hashedPassword = bcrypt.hashSync(password, 10);
        fetchDB(merchantsQuery.create, [name, email, hashedPassword], (err, result) => {
          if (err) return cb(err);

          merchant = result.rows[0];
          cb(null);
        });
      },
      // save and return new token
      (cb) => {
        const token = v4();
        redis.hSet('merchants', merchant.id, token);
        redis.hSet(
          'tokens',
          token,
          JSON.stringify({ id: merchant.id, expiresAt: moment().add(1, 'hour').valueOf() })
        );

        cb(null, token);
      },
      // return merchant
      (token, cb) => {
        res.status(200).json({
          success: true,
          token: token,
          merchant,
        });

        cb(null);
      },
    ],
    (err) => err && next(err)
  );
}

function loginMerchant(req, res, next) {
  let inputs;
  let merchant;

  async.waterfall(
    [
      // validate data
      (cb) => {
        const { email, password } = req.body;

        const validator = new LIVR.Validator({
          email: ['trim', 'email', 'required'],
          password: ['trim', 'string'],
        });

        inputs = validator.validate({ email, password });
        if (!inputs) return cb(new ValidationError(validator.getErrors()));

        cb(null);
      },
      // if merchant not exists, return error
      (cb) => {
        fetchDB(merchantsQuery.getOneByEmail, [inputs.email], (err, result) => {
          if (err) return cb(err);
          if (result.rows.length === 0) return cb(new CustomError('USER_NOT_FOUND'));

          merchant = result.rows[0];
          cb(null);
        });
      },
      // check if merchant is not blocked
      (cb) => {
        if (merchant.is_blocked) {
          const unblockTime = moment(merchant.last_login_attempt).add(1, 'minute');
          const timeLeft = unblockTime.diff(moment(), 'seconds');
          // if block time is not over, return error
          if (moment().isBefore(unblockTime)) {
            return cb(new CustomError('USER_BLOCKED', null, { timeLeft }));
          }

          // if block time is over, unblock merchant
          merchant.last_login_attempt = null;
          merchant.is_blocked = false;
        }

        cb(null);
      },
      // check password
      (cb) => {
        const { password } = inputs;
        const isPasswordCorrect = bcrypt.compareSync(password, merchant.hashed_password);

        if (!isPasswordCorrect) {
          // if last login attempt was more than 2 minute ago, then 1, else +1
          merchant.login_attempts =
            merchant.last_login_attempt && moment().diff(merchant.last_login_attempt, 'minutes') < 2
              ? merchant.login_attempts + 1
              : 1;

          // if login attempts is 3, block merchant
          if (merchant.login_attempts >= 3) merchant.is_blocked = true;
          merchant.last_login_attempt =
            merchant.login_attempts >= 3 || merchant.login_attempts === 1
              ? moment()
              : merchant.last_login_attempt;

          // save status
          return fetchDB(
            merchantsQuery.changeStatus,
            [
              merchant.is_blocked,
              merchant.login_attempts,
              merchant.last_login_attempt,
              merchant.id,
            ],
            (err) => {
              if (err) return cb(err);

              if (merchant.is_blocked) cb(new CustomError('USER_BLOCKED', null, { timeLeft: 60 }));
              else cb(new CustomError('WRONG_PASSWORD'));
            }
          );
        }

        // reset login attempts if password is correct
        fetchDB(merchantsQuery.changeStatus, [false, 0, null, merchant.id], (err) => {
          if (err) console.log(err);
        });

        cb(null);
      },
      // delete old token
      (cb) =>
        redis.hGet('merchants', merchant.id).then((oldToken) => {
          if (oldToken) redis.hDel('tokens', oldToken);
          cb(null);
        }),
      // save and return new token
      (cb) => {
        const token = v4();
        redis.hSet('merchants', merchant.id, token);
        redis.hSet(
          'tokens',
          token,
          JSON.stringify({ id: merchant.id, expiresAt: moment().add(1, 'hour').valueOf() })
        );

        res.status(200).json({
          token,
          merchant: {
            id: merchant.id,
            name: merchant.name,
            phone: merchant.phone,
            photo_url: merchant.photo_url,
            reg_date: merchant.reg_date,
          },
        });
        cb(null);
      },
    ],
    (err) => err && next(err)
  );
}

function getMerchantProfile(req, res, next) {
  async.waterfall(
    [
      (cb) => {
        verifyToken(req, (err, merchantId) => {
          if (err) return cb(err);
          cb(null, merchantId);
        });
      },
      (merchantId, cb) => {
        fetchDB(merchantsQuery.getOneById, [merchantId], (err, result) => {
          if (err) return cb(err);
          if (result.rows.length === 0) return cb(new CustomError('USER_NOT_FOUND'));

          const merchant = result.rows[0];
          delete merchant.hashed_password;
          res.status(200).json(merchant);
        });
      },
    ],
    (err) => err && next(err)
  );
}

function updateMerchant(req, res, next) {
  let inputs;
  let merchant;

  async.waterfall(
    [
      (cb) => {
        verifyToken(req, (err, merchantId) => {
          if (err) return cb(err);
          cb(null, merchantId);
        });
      },
      // validate data
      (merchantId, cb) => {
        const { name, password } = req.body;

        const validator = new LIVR.Validator({
          name: ['trim', 'string', { min_length: 2 }, { max_length: 30 }],
          password: ['trim', 'string', { min_length: 7 }, 'alphanumeric'],
        });

        inputs = validator.validate({
          name,
          password,
        });
        if (!inputs) return cb(new ValidationError(validator.getErrors()));

        cb(null, merchantId);
      },
      // check if merchant exists
      (merchantId, cb) => {
        fetchDB(merchantsQuery.getOneById, [merchantId], (err, result) => {
          if (err) return cb(err);
          if (result.rows.length === 0) return cb(new CustomError('USER_NOT_FOUND'));

          merchant = result.rows[0];
          cb(null);
        });
      },
      // update merchant
      (cb) => {
        const { name, password } = inputs;
        const hashedPassword = password ? bcrypt.hashSync(password, 10) : merchant.hashed_password;
        fetchDB(merchantsQuery.update, [name, hashedPassword, merchant.id], (err, result) => {
          if (err) return cb(err);

          merchant = result.rows[0];

          res.status(200).json({
            success: true,
            merchant,
          });

          cb(null);
        });
      },
    ],
    (err) => err && next(err)
  );
}

module.exports = {
  registerMerchant,
  loginMerchant,
  updateMerchant,
  getMerchantProfile,
};