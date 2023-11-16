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
const Limiter = require('../utils/limiter');

// @Public
function sendCodeToEmail(req, res, next) {
  let inputs, limiter;

  async.waterfall(
    [
      // validate data
      (cb) => {
        const { email } = req.body;
        const deviceId = req.headers['x-device-id'];

        const validator = new LIVR.Validator({
          email: ['trim', 'email', 'required'],
          deviceId: ['trim', 'string', 'required'],
        });

        const validData = validator.validate({
          email: email.toLowerCase(),
          deviceId,
        });
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
      // check if sending code is not blocked
      (cb) => {
        limiter = new Limiter('email_limiter', inputs.deviceId);
        limiter.getStatus((err, status) => {
          if (err) return cb(err);

          const { isBlocked, timeLeft } = status;
          if (isBlocked) return cb(new CustomError('TRY_AGAIN_AFTER', null, { timeLeft }));

          cb(null);
        });
      },
      // send email
      (cb) => {
        const code = Math.floor(100000 + Math.random() * 900000);
        emailer
          .sendVerification(inputs.email, code)
          .then(() => cb(null, code))
          .catch(cb);
      },
      // record attempt
      (code, cb) => {
        const limiterCb = ({ error }) => {
          if (error) return cb(error);

          cb(null, code);
        };

        limiter.record(true, limiterCb);
      },
      // save code
      (code, cb) => {
        const value = {
          code,
          email: inputs.email,
          exp: moment().add(5, 'minutes').valueOf(),
          tries: 0,
        };

        redis.hSet('merchant_otp', inputs.deviceId, JSON.stringify(value), (err) => {
          if (err) return cb(err);
          cb(null);
        });
      },
    ],
    (err) => {
      if (err) return next(err);

      res.status(200).json({
        success: true,
        timeLeft: 120,
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
        const deviceId = req.headers['x-device-id'];

        const validator = new LIVR.Validator({
          name: ['trim', 'string', 'required', { min_length: 2 }, { max_length: 30 }],
          email: ['trim', 'email', 'required'],
          password: ['trim', 'required', { min_length: 7 }, 'alphanumeric'],
          otp: ['trim', 'required'],
          deviceId: ['trim', 'string', 'required'],
        });

        const validData = validator.validate({
          name,
          email: email.toLowerCase(),
          password,
          otp,
          deviceId,
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
        redis.hGet('merchant_otp', inputs.deviceId, (err, details) => {
          if (err) return cb(err);
          const detailsObject = JSON.parse(details || '{}');
          const expired = moment().isAfter(moment(detailsObject.exp));
          const tooManyTries = detailsObject.tries >= 3;
          const sameEmail = detailsObject.email === inputs.email;
          const sameCode = detailsObject.code === parseInt(inputs.otp);

          if (!details || tooManyTries || !sameCode || !sameEmail || expired) {
            detailsObject.tries += 1;
            redis.hSet('merchant_otp', inputs.deviceId, JSON.stringify(detailsObject));

            if (tooManyTries || detailsObject.tries >= 3)
              return cb(new CustomError('TOO_MANY_TRIES'));
            if (expired) return cb(new CustomError('EXPIRED_OTP'));
            return cb(new CustomError('WRONG_OTP'));
          }

          redis.hDel('merchant_otp', inputs.deviceId);
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
              exp: moment().add(1, 'hour').valueOf(),
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
  let inputs, merchant, token, limiter;

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
      // check if merchant is not blocked
      (cb) => {
        limiter = new Limiter('merchant_login_limiter', inputs.deviceId);

        limiter.getStatus((err, status) => {
          if (err) return cb(err);

          const { isBlocked, timeLeft } = status;
          if (isBlocked) return cb(new CustomError('USER_BLOCKED', null, { timeLeft }));

          cb(null);
        });
      },
      // login with attempts limiter
      (cb) => {
        const { password } = inputs;
        const passwordIsCorrect = bcrypt.compareSync(password, merchant.hashed_password);

        const increaseAttempt = passwordIsCorrect ? false : true;

        const limiterCb = ({ error, canTryAgain, timeLeft }) => {
          if (passwordIsCorrect) return cb(null);

          if (error) return cb(error);
          if (!canTryAgain) return cb(new CustomError('USER_BLOCKED', null, { timeLeft }));

          cb(new CustomError('WRONG_PASSWORD'));
        };

        limiter.record(increaseAttempt, limiterCb);
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
              exp: moment().add(1, 'hour').valueOf(),
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
