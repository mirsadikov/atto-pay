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
const acceptsLanguages = require('../utils/acceptsLanguages');
const emailer = require('../utils/emailer');

// @Public
function sendCodeToEmail(req, res, next) {
  let inputs,
    alreadySent,
    canResendAfter = 120;

  async.waterfall(
    [
      // validate data
      (cb) => {
        const { email, resend } = req.body;

        const validator = new LIVR.Validator({
          email: ['trim', 'email', 'required'],
          resend: ['trim', 'boolean'],
        });

        const validData = validator.validate({ email, resend });
        if (!validData) return cb(new ValidationError(validator.getErrors()));

        inputs = validData;
        cb(null);
      },
      // check if merchant not already exists
      (cb) => {
        fetchDB(merchantsQuery.getOneByEmail, [inputs.email], (err, result) => {
          if (err) return cb(err);
          if (result.rows.length > 0) return cb(new CustomError('EMAIL_TAKEN'));

          cb(null);
        });
      },
      // check if code already sent
      (cb) => {
        redis.hGet('merchant_otp', inputs.email, (err, details) => {
          if (err) return cb(err);
          if (!details) return cb(null);

          const detailsObject = JSON.parse(details);
          canResendAfter = moment(detailsObject.iat).add(2, 'minutes').diff(moment(), 'seconds');

          // if 2 minutes passed, can resend
          if (canResendAfter <= 0) return cb(null);

          if (inputs.resend && canResendAfter > 0)
            return cb(new CustomError('CODE_ALREADY_SENT', null, { timeLeft: canResendAfter }));

          alreadySent = true;

          cb(null);
        });
      },
      // send code to email
      (cb) => {
        if (alreadySent) return cb(null, null);

        const code = Math.floor(100000 + Math.random() * 900000);

        emailer.sendVerification(inputs.email, code, (err) => {
          if (err) return cb(err);

          cb(null, code);
        });
      },
      // save code
      (code, cb) => {
        if (alreadySent) return cb(null);

        const value = {
          code,
          exp: moment().add(5, 'minutes').valueOf(),
          iat: moment().valueOf(),
        };

        redis.hSet('merchant_otp', inputs.email, JSON.stringify(value), (err) => {
          if (err) return cb(err);
          cb(null);
        });
      },
    ],
    (err) => {
      if (err) return next(err);

      res.status(200).json({
        success: true,
        timeLeft: canResendAfter > 0 ? canResendAfter : 120,
      });
    }
  );
}

// @Public
function registerMerchant(req, res, next) {
  let inputs, newMerchant, token;

  async.waterfall(
    [
      // validate data
      (cb) => {
        const { name, email, password, otp } = req.body;

        const validator = new LIVR.Validator({
          name: ['trim', 'string', 'required', { min_length: 2 }, { max_length: 30 }],
          email: ['trim', 'email', 'required'],
          password: ['trim', 'required', { min_length: 7 }, 'alphanumeric'],
          otp: ['trim', 'required'],
        });

        const validData = validator.validate({
          name,
          email: email.toLowerCase(),
          password,
          otp,
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
      // check if code is correct
      (cb) => {
        redis.hGet('merchant_otp', inputs.email, (err, details) => {
          if (err) return cb(err);
          if (!details) return cb(new CustomError('WRONG_OTP'));

          const detailsObject = JSON.parse(details);
          if (moment().isAfter(detailsObject.exp)) {
            redis.hDel('merchant_otp', inputs.email);
            return cb(new CustomError('EXPIRED_OTP'));
          }

          if (detailsObject.code !== parseInt(inputs.otp)) {
            detailsObject.tries = detailsObject.tries ? detailsObject.tries + 1 : 1;

            if (detailsObject.tries >= 3) {
              redis.hDel('merchant_otp', inputs.email);
              return cb(new CustomError('EXPIRED_OTP'));
            }

            redis.hSet('merchant_otp', inputs.email, JSON.stringify(detailsObject));

            return cb(new CustomError('WRONG_OTP'));
          }

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
        if (newMerchant) fetchDB(merchantsQuery.delete, [newMerchant.id]);

        return next(err);
      }

      // return merchant
      res.status(200).json({
        success: true,
        token,
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
        const deviceId = req.headers['x-device-id'];

        const validator = new LIVR.Validator({
          email: ['trim', 'email', 'required'],
          password: ['trim', 'string'],
          deviceId: ['trim', 'string', 'required'],
        });

        const validData = validator.validate({
          email: email.toLowerCase(),
          password,
          deviceId,
        });
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
      // check if device is not blocked
      (cb) => {
        redis.hGet('merchant_login', inputs.deviceId, (err, loginObject) => {
          if (err) return cb(err);
          if (!loginObject) return cb(null);

          merchantStatus = JSON.parse(loginObject);
          if (merchantStatus.is_blocked) {
            const unblockTime = moment(merchantStatus.last_login_attempt).add(2, 'minute');
            const timeLeft = unblockTime.diff(moment(), 'seconds');

            // if block time is not over, return error
            if (timeLeft > 0) {
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
        const { password, deviceId } = inputs;
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
            // if 3 login attempts in 1 minute
            merchantStatus.is_blocked = true;
            merchantStatus.safe_login_after = 0;
          } else {
            // calculate time that merchant should wait before next login not to be blocked
            merchantStatus.safe_login_after = merchantStatus.last_login_attempt
              ? Math.max(60 - moment().diff(merchantStatus.last_login_attempt, 'seconds'), 0)
              : 0;
          }

          merchantStatus.last_login_attempt = moment();
          // save status
          return redis.hSet('merchant_login', deviceId, JSON.stringify(merchantStatus), (err) => {
            if (err) return cb(err);

            if (merchantStatus.is_blocked)
              cb(new CustomError('USER_BLOCKED', null, { timeLeft: 120 }));
            else cb(new CustomError('WRONG_PASSWORD'));
          });
        }

        // reset login attempts if password is correct
        redis.hDel('merchant_login', deviceId);

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

        fetchDB(merchantsQuery.update, [newName, hashedPassword, merchant.id], (err, res) => {
          if (err) return cb(err);

          const message = res.rows[0].message[acceptsLanguages(req)];
          cb(null, message);
        });
      },
    ],
    (err, message) => {
      if (err) return next(err);

      res.status(200).json({
        success: true,
        message,
      });
    }
  );
}

// @Private
// @Merchant
function updateMerchantLang(req, res, next) {
  let merchantId;

  async.waterfall(
    [
      // verify merchant
      (cb) => {
        verifyToken(req, 'merchant', (err, id) => {
          if (err) return cb(err);

          merchantId = id;
          cb(null);
        });
      },
      // validate data
      (cb) => {
        const { lang } = req.body;

        const validator = new LIVR.Validator({
          lang: ['trim', 'string', 'required', { one_of: ['en', 'ru', 'uz'] }],
        });

        const validData = validator.validate({ lang });
        if (!validData) return cb(new ValidationError(validator.getErrors()));

        cb(null, validData);
      },
      // update merchant
      (inputs, cb) => {
        fetchDB(merchantsQuery.updateLang, [inputs.lang, merchantId], (err) => {
          if (err) return cb(err);

          cb(null);
        });
      },
    ],
    (err) => {
      if (err) return next(err);

      res.status(200).json({
        success: true,
      });
    }
  );
}

module.exports = {
  registerMerchant,
  loginMerchant,
  updateMerchant,
  getMerchantProfile,
  updateMerchantLang,
  sendCodeToEmail,
};
