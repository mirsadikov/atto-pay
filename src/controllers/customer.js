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
  async.waterfall(
    [
      // validate data
      (cb) => {
        const { name, phone, password, uid, trust } = req.body;

        const validator = new LIVR.Validator({
          name: ['trim', 'string', 'required'],
          phone: ['trim', 'positive_integer', 'required'],
          password: ['trim', 'required', { min_length: 6 }, 'alphanumeric'],
          trust: ['boolean'],
          uid: ['trim', 'string', { required_if: { trust: true } }],
        });

        const validData = validator.validate({ name, phone, password, trust, uid });
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

          cb(null, data, result.rows[0]);
        });
      },
      // trust device if needed
      (data, createdUser, cb) => {
        if (data.trust)
          return fetchDB(devicesQuery.create, [createdUser.id, data.uid], (err) => {
            if (err) return cb(err);

            cb(null, createdUser);
          });

        cb(null, createdUser);
      },
      // return user
      (createdUser, cb) => {
        res.status(200).json({
          success: true,
          details: createdUser,
        });
        cb(null);
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
      // check if user is not blocked
      (inputs, user, cb) => {
        if (user.is_blocked) {
          const blockedUntil = moment(user.last_login_attempt).add(1, 'minute');
          // if block time is not over, return error
          if (moment().isBefore(blockedUntil)) {
            return cb(new CustomError('USER_BLOCKED'));
          }

          // if block time is over, unblock user
          user.last_login_attempt = null;
          user.is_blocked = false;
          return cb(null, inputs, user);
        }

        cb(null, inputs, user);
      },
      // check password
      (inputs, user, cb) => {
        const { password: hashedPassword } = inputs;

        const isPasswordCorrect = bcrypt.compareSync(hashedPassword, user.hashed_password);
        if (!isPasswordCorrect) {
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
              else cb(new CustomError('WRONG_PASSWORD'));
            }
          );
        }

        // reset login attempts if password is correct
        fetchDB(customersQuery.changeStatus, [false, 0, null, user.id], (err) => {
          if (err) console.log(err);
        });

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
        const { name, password, deletePhoto } = req.body;

        const validator = new LIVR.Validator({
          name: ['trim', 'string'],
          password: ['trim', { min_length: 6 }, 'alphanumeric'],
          deletePhoto: [{ one_of: [true, false] }, { default: false }],
        });

        const validData = validator.validate({ name, password, deletePhoto });
        if (!validData) return cb(new ValidationError(validator.getErrors()));

        cb(null, userId, validData);
      },
      // get user
      (userId, newData, cb) => {
        fetchDB(customersQuery.getOneById, [userId], (err, result) => {
          if (err) return cb(err);
          if (result.rows.length === 0) return cb(new CustomError('USER_NOT_FOUND'));
          cb(null, result.rows[0], newData);
        });
      },
      // delete old photo if requested or new photo attached
      (user, newData, cb) => {
        if (!user.photo_url) return cb(null, user, newData);

        if (newData.deletePhoto || (req.files && req.files.avatar)) {
          imageStorage.delete(user.photo_url, (err) => {
            if (err) return cb(err);

            user.photo_url = null;
            cb(null, user, newData);
          });
        } else {
          cb(null, user, newData);
        }
      },
      // save new photo if attached
      (user, newData, cb) => {
        if (req.files && req.files.avatar) {
          imageStorage.upload(req.files.avatar, user.id, (err, newFileName) => {
            if (err) return cb(err);
            cb(null, user, newData, newFileName);
          });
        } else {
          cb(null, user, newData, user.photo_url);
        }
      },
      // update user
      (user, newData, newFileName, cb) => {
        const { name, password } = newData;
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

module.exports = {
  getCustomerProfile,
  customerRegister,
  customerLogin,
  updateCustomer,
  getPhoto,
};
