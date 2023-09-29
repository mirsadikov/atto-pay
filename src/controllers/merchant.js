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

// @Public
function registerMerchant(req, res, next) {
  let inputs, newMerchant, token;

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

          newMerchant = result.rows[0];
          cb(null);
        });
      },
      // save and return new token
      (cb) => {
        token = v4();
        redis.hSet('merchants', newMerchant.id, token, (err) => {
          if (err) return cb(err);
          cb(null);
        });
      },
      (cb) => {
        redis
          .hSet(
            'tokens',
            token,
            JSON.stringify({
              id: newMerchant.id,
              role: 'merchant',
              expiresAt: moment().add(1, 'hour').valueOf(),
            })
          )
          .then(() => cb(null));
      },
    ],
    (err) => {
      if (err) {
        // clear
        if (newMerchant) fetchDB(merchantsQuery.delete, [newMerchant.id, newMerchant.email]);

        return next(err);
      }

      // return merchant
      res.status(200).json({
        success: true,
        token,
        merchant: newMerchant,
      });
    }
  );
}

// @Public
function loginMerchant(req, res, next) {
  let inputs,
    merchant,
    token,
    merchantStatus = {};

  async.waterfall(
    [
      // validate data
      (cb) => {
        const { email, password } = req.body;

        const validator = new LIVR.Validator({
          email: ['trim', 'email', 'required'],
          password: ['trim', 'string'],
        });

        const validData = validator.validate({ email, password });
        if (!validData) return cb(new ValidationError(validator.getErrors()));

        inputs = validData;
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
        redis.hGet('merchant_login', inputs.email, (err, loginObject) => {
          if (err) return cb(err);
          if (!loginObject) return cb(null);

          merchantStatus = JSON.parse(loginObject);
          if (merchantStatus.is_blocked) {
            const unblockTime = moment(merchantStatus.last_login_attempt).add(1, 'minute');
            // if block time is not over, return error
            if (moment().isBefore(unblockTime)) {
              const timeLeft = unblockTime.diff(moment(), 'seconds');
              return cb(new CustomError('USER_BLOCKED', null, { timeLeft }));
            }

            // if block time is over, unblock merchant
            merchantStatus.last_login_attempt = null;
            merchantStatus.is_blocked = false;
          }

          cb(null);
        });
      },
      // check password
      (cb) => {
        const { password } = inputs;
        const isPasswordCorrect = bcrypt.compareSync(password, merchant.hashed_password);

        // if password is wrong
        if (!isPasswordCorrect) {
          if (
            merchantStatus.last_login_attempt &&
            moment().isBefore(
              moment(merchantStatus.last_login_attempt).add(
                merchantStatus.safe_login_after,
                'seconds'
              )
            )
          ) {
            // if 3 login attempts in 2 minutes
            merchantStatus.is_blocked = true;
            merchantStatus.safe_login_after = 0;
          } else {
            // calculate time that merchant should wait before next login not to be blocked
            merchantStatus.safe_login_after = merchantStatus.last_login_attempt
              ? Math.max(120 - moment().diff(merchantStatus.last_login_attempt, 'seconds'), 0)
              : 0;
          }

          merchantStatus.last_login_attempt = moment();
          // save status
          return redis.hSet(
            'merchant_login',
            merchant.email,
            JSON.stringify(merchantStatus),
            (err) => {
              if (err) return cb(err);

              if (merchantStatus.is_blocked)
                cb(new CustomError('USER_BLOCKED', null, { timeLeft: 60 }));
              else cb(new CustomError('WRONG_PASSWORD'));
            }
          );
        }

        // reset login attempts if password is correct
        redis.hDel('merchant_login', inputs.email);

        cb(null);
      },
      // delete old token
      (cb) =>
        redis.hGet('merchants', merchant.id, (err, oldToken) => {
          if (err) return cb(err);
          if (oldToken) redis.hDel('tokens', oldToken);
          cb(null);
        }),
      // save and return new token
      (cb) => {
        token = v4();
        redis.hSet('merchants', merchant.id, token, (err) => {
          if (err) return cb(err);
          cb(null);
        });
      },
      (cb) => {
        redis
          .hSet(
            'tokens',
            token,
            JSON.stringify({
              id: merchant.id,
              role: 'merchant',
              expiresAt: moment().add(1, 'hour').valueOf(),
            })
          )
          .then(() => cb(null));
      },
    ],
    (err) => {
      if (err) return next(err);

      // return merchant
      res.status(200).json({
        token,
        merchant: {
          id: merchant.id,
          name: merchant.name,
          email: merchant.email,
          reg_date: merchant.reg_date,
        },
      });
    }
  );
}

// @Private
// @Merchant
function getMerchantProfile(req, res, next) {
  async.waterfall(
    [
      (cb) => {
        verifyToken(req, 'merchant', (err, merchantId) => {
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
          cb(null, merchant);
        });
      },
    ],
    (err, merchant) => {
      if (err) return next(err);

      res.status(200).json(merchant);
    }
  );
}

// @Private
// @Merchant
function updateMerchant(req, res, next) {
  let inputs, merchantId, merchant;

  async.waterfall(
    [
      (cb) => {
        verifyToken(req, 'merchant', (err, id) => {
          if (err) return cb(err);

          merchantId = id;
          cb(null);
        });
      },
      // validate data
      (cb) => {
        const { name, password } = req.body;

        const validator = new LIVR.Validator({
          name: ['trim', 'string', { min_length: 2 }, { max_length: 30 }],
          password: ['trim', 'string', { min_length: 7 }, 'alphanumeric'],
        });

        const validData = validator.validate({
          name,
          password,
        });
        if (!validData) return cb(new ValidationError(validator.getErrors()));

        inputs = validData;
        cb(null);
      },
      // check if merchant exists
      (cb) => {
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

        const newName = name || merchant.name;
        const hashedPassword = password ? bcrypt.hashSync(password, 10) : merchant.hashed_password;

        fetchDB(merchantsQuery.update, [newName, hashedPassword, merchant.id], (err, result) => {
          if (err) return cb(err);

          cb(null, result.rows[0]);
        });
      },
    ],
    (err, merchant) => {
      if (err) return next(err);

      res.status(200).json({
        success: true,
        merchant,
      });
    }
  );
}

module.exports = {
  registerMerchant,
  loginMerchant,
  updateMerchant,
  getMerchantProfile,
};
