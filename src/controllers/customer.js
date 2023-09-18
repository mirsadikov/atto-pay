const async = require('async');
const v4 = require('uuid').v4;
const moment = require('moment');
const bcrypt = require('bcrypt');
const fetchDB = require('../postgres');
const redis = require('../redis');
const { customersQuery, devicesQuery } = require('../postgres/queries');
const verifyToken = require('../middleware/verifyToken');
const LIVR = require('../utils/livr');
const ValidationError = require('../errors/ValidationError');
const CustomError = require('../errors/CustomError');
const imageStorage = require('../utils/imageStorage');

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
          delete user.hashed_password;
          res.status(200).json(user);
        });
      },
    ],
    (err) => err && next(err)
  );
}

function customerRegister(req, res, next) {
  let inputs;
  let user;

  async.waterfall(
    [
      // validate data
      (cb) => {
        const { name, phone, password, uid, trust } = req.body;

        const validator = new LIVR.Validator({
          name: ['trim', 'string', 'required'],
          phone: ['trim', 'positive_integer', 'required'],
          password: ['trim', 'required', { min_length: 6 }, 'alphanumeric'],
          trust: ['boolean', { default: false }],
          uid: ['trim', 'string', { required_if: { trust: true } }],
        });

        const validData = validator.validate({ name, phone, password, trust, uid });
        if (!validData) return cb(new ValidationError(validator.getErrors()));

        inputs = validData;
        cb(null);
      },
      // if user exists, return error
      (cb) => {
        fetchDB(customersQuery.getOneByPhone, [inputs.phone], (err, result) => {
          if (err) return cb(err);
          if (result.rows.length > 0) return cb(new CustomError('USER_EXISTS'));

          cb(null);
        });
      },
      // if new user, create user
      (cb) => {
        const { name, phone, password } = inputs;
        const hashedPassword = bcrypt.hashSync(password, 10);
        fetchDB(customersQuery.create, [name, phone, hashedPassword], (err, result) => {
          if (err) return cb(err);

          user = result.rows[0];
          cb(null);
        });
      },
      // trust device if needed
      (cb) => {
        if (inputs.trust)
          return fetchDB(devicesQuery.create, [user.id, inputs.uid], (err) => {
            if (err) return cb(err);

            cb(null);
          });

        cb(null);
      },
      // return user
      (cb) => {
        res.status(200).json({
          success: true,
          details: user,
        });
        cb(null);
      },
    ],
    (err) => err && next(err)
  );
}

function getLoginType(req, res, next) {
  async.waterfall(
    [
      (cb) => {
        const { uid, phone } = req.body;

        const validator = new LIVR.Validator({
          phone: ['trim', 'positive_integer', 'required'],
          uid: ['trim', 'string', 'required'],
        });

        const validData = validator.validate({ uid, phone });
        if (!validData) return cb(new ValidationError(validator.getErrors()));

        cb(null, validData);
      },
      (data, cb) => {
        fetchDB(devicesQuery.getOneByUid, [data.uid, data.phone], (err, result) => {
          if (err) return cb(err);

          if (result.rows.length > 0) {
            const otp = Math.floor(100000 + Math.random() * 900000);

            redis.hSet('otp', data.phone, otp).then(() => {
              // TODO: send otp to user
              res.status(200).json({ password: false, otp: true });
            });
          } else {
            res.status(200).json({ password: true, otp: false });
          }

          cb(null);
        });
      },
    ],
    (err) => err && next(err)
  );
}

function customerLogin(req, res, next) {
  let inputs;
  let user;

  async.waterfall(
    [
      // validate data
      (cb) => {
        const { phone, password, uid, trust, otp } = req.body;

        const validator = new LIVR.Validator({
          phone: ['trim', 'positive_integer', 'required'],
          trust: ['boolean', { default: false }],
          uid: ['trim', 'string', 'required'],
          password: ['trim', 'alphanumeric'],
          otp: ['trim', 'positive_integer'],
        });

        inputs = validator.validate({ phone, password, uid, trust, otp });
        if (!inputs) return cb(new ValidationError(validator.getErrors()));

        cb(null);
      },
      // if user not exists, return error
      (cb) => {
        fetchDB(customersQuery.getOneByPhone, [inputs.phone], (err, result) => {
          if (err) return cb(err);
          if (result.rows.length === 0) return cb(new CustomError('USER_NOT_FOUND'));

          user = result.rows[0];
          cb(null);
        });
      },
      // check if user is not blocked
      (cb) => {
        if (user.is_blocked) {
          const blockedUntil = moment(user.last_login_attempt).add(1, 'minute');
          // if block time is not over, return error
          if (moment().isBefore(blockedUntil)) {
            return cb(new CustomError('USER_BLOCKED'));
          }

          // if block time is over, unblock user
          user.last_login_attempt = null;
          user.is_blocked = false;
        }

        cb(null);
      },
      // determine login type
      (cb) => {
        const { phone, uid, otp, password } = inputs;

        fetchDB(devicesQuery.getOneByUid, [uid, phone], (err, result) => {
          if (err) return cb(err);

          if (result.rows.length > 0) {
            const validator = new LIVR.Validator({ otp: 'required' });
            const otpValid = validator.validate({ otp });
            if (!otpValid) return cb(new ValidationError(validator.getErrors()));
            return cb(null, 'otp');
          }

          const validator = new LIVR.Validator({ password: 'required' });
          const passwordValid = validator.validate({ password });
          if (!passwordValid) return cb(new ValidationError(validator.getErrors()));
          cb(null, 'password');
        });
      },
      // check password or otp
      (loginType, cb) => {
        const { password: hashedPassword, otp } = inputs;
        if (loginType === 'password') {
          const isPasswordCorrect = bcrypt.compareSync(hashedPassword, user.hashed_password);
          cb(null, isPasswordCorrect, loginType);
        } else {
          redis.hGet('otp', user.phone).then((redisOtp) => {
            if (otp == redisOtp) {
              redis.hDel('otp', user.phone);
              return cb(null, true, loginType);
            }

            cb(null, false, loginType);
          });
        }
      },
      // if password is wrong, increase login attempts
      (isValidCreadentials, loginType, cb) => {
        if (!isValidCreadentials) {
          // if last login attempt was more than 1 minute ago, then 1, else +1
          user.login_attempts =
            user.last_login_attempt && moment().diff(user.last_login_attempt, 'minutes') < 1
              ? user.login_attempts + 1
              : 1;

          // if login attempts is 3, block user
          if (user.login_attempts >= 3) user.is_blocked = true;

          // save status
          return fetchDB(
            customersQuery.changeStatus,
            [user.is_blocked, user.login_attempts, moment(), user.id],
            (err) => {
              if (err) return cb(err);

              if (user.is_blocked) cb(new CustomError('USER_BLOCKED'));
              else cb(new CustomError(loginType === 'password' ? 'WRONG_PASSWORD' : 'WRONG_OTP'));
            }
          );
        }

        // reset login attempts if password is correct
        fetchDB(customersQuery.changeStatus, [false, 0, null, user.id], (err) => {
          if (err) console.log(err);
        });

        cb(null);
      },
      // if login is successful
      (cb) => {
        async.parallel(
          [
            // trust device if needed
            (cb) => {
              if (inputs.trust)
                fetchDB(devicesQuery.create, [user.id, inputs.uid], (err) => {
                  if (err) return cb(err);
                  cb(null);
                });
              else cb(null);
            },
            // delete old token
            (cb) =>
              redis.hGet('users', user.id).then((oldToken) => {
                if (oldToken) redis.hDel('tokens', oldToken);
                cb(null);
              }),
          ],
          (err) => {
            if (err) console.log(err);
            cb(null);
          }
        );
      },
      // save and return new token
      (cb) => {
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
  let userId;
  let user;
  let inputs;

  async.waterfall(
    [
      (cb) => {
        verifyToken(req, (err, id) => {
          if (err) return cb(err);

          userId = id;
          cb(null);
        });
      },
      // validate data
      (cb) => {
        const { name, password, deletePhoto } = req.body;

        const validator = new LIVR.Validator({
          name: ['trim', 'string'],
          password: ['trim', { min_length: 6 }, 'alphanumeric'],
          deletePhoto: [{ one_of: [true, false] }, { default: false }],
        });

        const validData = validator.validate({ name, password, deletePhoto });
        if (!validData) return cb(new ValidationError(validator.getErrors()));

        inputs = validData;
        cb(null);
      },
      // get user
      (cb) => {
        fetchDB(customersQuery.getOneById, [userId], (err, result) => {
          if (err) return cb(err);
          if (result.rows.length === 0) return cb(new CustomError('USER_NOT_FOUND'));
          user = result.rows[0];
          cb(null);
        });
      },
      // delete old photo if requested or new photo attached
      (cb) => {
        if (!user.photo_url) return cb(null);

        if (inputs.deletePhoto || (req.files && req.files.avatar)) {
          imageStorage.delete(user.photo_url, (err) => {
            if (err) return cb(err);

            user.photo_url = null;
            cb(null);
          });
        } else {
          cb(null);
        }
      },
      // save new photo if attached
      (cb) => {
        if (req.files && req.files.avatar) {
          imageStorage.upload(req.files.avatar, user.id, (err, newFileName) => {
            if (err) return cb(err);
            cb(null, newFileName);
          });
        } else {
          cb(null, user.photo_url);
        }
      },
      // update user
      (newFileName, cb) => {
        const { name, password } = inputs;
        const newName = name || user.name;
        const hashedPassword = password ? bcrypt.hashSync(password, 10) : user.hashed_password;

        fetchDB(
          customersQuery.update,
          [newName, hashedPassword, newFileName, user.id],
          (err, result) => {
            if (err) return cb(err);

            res.status(200).json({
              success: true,
              details: result.rows[0],
            });

            cb(null);
          }
        );
      },
    ],
    (err) => err && next(err)
  );
}

function getPhoto(req, res, next) {
  async.waterfall(
    [
      (cb) => {
        const { file } = req.params;

        imageStorage.getPathIfExists(file, (err, filePath) => {
          if (err) return cb(err);
          res.sendFile(filePath);
          cb(null);
        });
      },
    ],
    (err) => err && next(err)
  );
}

// FAKE OTP GETTER
function getOtpFromSMS(req, res, next) {
  try {
    const { phone } = req.params;

    redis.hGet('otp', phone).then((otp) => {
      if (!otp) return res.send('');

      res.send(otp);
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getCustomerProfile,
  customerRegister,
  getLoginType,
  getOtpFromSMS,
  customerLogin,
  updateCustomer,
  getPhoto,
};
