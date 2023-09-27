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

// @Private
// @Customer
function getCustomerProfile(req, res, next) {
  async.waterfall(
    [
      (cb) => {
        verifyToken(req, 'customer', (err, customerId) => {
          if (err) return cb(err);
          cb(null, customerId);
        });
      },
      (customerId, cb) => {
        fetchDB(customersQuery.getOneById, [customerId], (err, result) => {
          if (err) return cb(err);
          if (result.rows.length === 0) return cb(new CustomError('USER_NOT_FOUND'));

          const customer = result.rows[0];
          delete customer.hashed_password;
          customer.image_url = imageStorage.getImageUrl('/customer/photo', customer.image_url);

          res.status(200).json(customer);
        });
      },
    ],
    (err) => err && next(err)
  );
}

// @Public
function registerCustomer(req, res, next) {
  let inputs, newCustomer;

  async.waterfall(
    [
      // validate data
      (cb) => {
        const { name, phone, password, trust } = req.body;
        const deviceId = req.headers['x-device-id'];

        const validator = new LIVR.Validator({
          name: ['trim', 'string', 'required', { min_length: 3 }, { max_length: 64 }],
          phone: ['trim', 'is_phone_number', 'required'],
          password: ['trim', 'required', { min_length: 6 }, 'alphanumeric'],
          trust: ['boolean', { default: false }],
          deviceId: ['trim', 'string', { required_if: { trust: true } }],
        });

        const validData = validator.validate({
          name,
          phone: Math.abs(phone),
          password,
          trust,
          deviceId,
        });
        if (!validData) return cb(new ValidationError(validator.getErrors()));

        inputs = validData;
        cb(null);
      },
      // if customer exists, return error
      (cb) => {
        fetchDB(customersQuery.getOneByPhone, [inputs.phone], (err, result) => {
          if (err) return cb(err);
          if (result.rows.length > 0) return cb(new CustomError('NUMBER_TAKEN'));

          cb(null);
        });
      },
      // if new customer, create customer
      (cb) => {
        const { name, phone, password } = inputs;
        const hashedPassword = bcrypt.hashSync(password, 10);
        fetchDB(customersQuery.create, [name, phone, hashedPassword], (err, result) => {
          if (err) return cb(err);

          newCustomer = result.rows[0];
          cb(null);
        });
      },
      (cb) => {
        const token = v4();
        async.parallel(
          [
            // save new token
            (cb) => redis.hSet('customers', newCustomer.id, token).then(() => cb(null)),
            (cb) =>
              redis
                .hSet(
                  'tokens',
                  token,
                  JSON.stringify({
                    id: newCustomer.id,
                    role: 'customer',
                    expiresAt: moment().add(1, 'hour').valueOf(),
                  })
                )
                .then(() => cb(null)),
            // trust device if needed
            (cb) => {
              if (inputs.trust)
                return fetchDB(devicesQuery.create, [newCustomer.id, inputs.deviceId], (err) => {
                  if (err) return cb(err);

                  cb(null);
                });

              cb(null);
            },
          ],
          (err) => {
            if (err) return cb(err);

            // return customer
            res.status(200).json({
              success: true,
              token,
              customer: newCustomer,
            });

            cb(null);
          }
        );
      },
    ],
    (err) => {
      if (err) {
        // clear
        if (newCustomer) fetchDB(customersQuery.delete, [newCustomer.id, newCustomer.phone]);

        return next(err);
      }
    }
  );
}

// @Public
function getCustomerLoginType(req, res, next) {
  let inputs;

  async.waterfall(
    [
      (cb) => {
        const { phone } = req.body;
        const deviceId = req.headers['x-device-id'];

        const validator = new LIVR.Validator({
          phone: ['trim', 'is_phone_number', 'required'],
          deviceId: ['trim', 'string'],
        });

        const validData = validator.validate({ deviceId, phone: Math.abs(phone) });
        if (!validData) return cb(new ValidationError(validator.getErrors()));

        inputs = validData;
        cb(null);
      },
      // check if customer exists
      (cb) => {
        fetchDB(customersQuery.getOneByPhone, [inputs.phone], (err, result) => {
          if (err) return cb(err);
          if (result.rows.length == 0) return cb(new CustomError('USER_NOT_FOUND'));

          cb(null);
        });
      },
      (cb) => {
        if (!inputs.deviceId) {
          res.json({ password: true, otp: false });
          return cb(null);
        }

        fetchDB(devicesQuery.getOneByUid, [inputs.deviceId, inputs.phone], (err, result) => {
          if (err) return cb(err);

          if (result.rows.length > 0) {
            const otpObject = {
              code: Math.floor(100000 + Math.random() * 900000),
              expiresAt: moment().add(2, 'minutes').valueOf(),
            };

            redis.hSet('otp', inputs.phone, JSON.stringify(otpObject)).then(() => {
              // TODO: send otp to customer
              res.json({ password: false, otp: true });
            });
          } else {
            res.json({ password: true, otp: false });
          }

          cb(null);
        });
      },
    ],
    (err) => err && next(err)
  );
}

// @Public
function loginCustomer(req, res, next) {
  let inputs, customer;

  async.waterfall(
    [
      // validate data
      (cb) => {
        const { phone, password, trust, otp } = req.body;
        const deviceId = req.headers['x-device-id'];

        const validator = new LIVR.Validator({
          phone: ['trim', 'is_phone_number', 'required'],
          trust: ['boolean', { default: false }],
          deviceId: ['trim', 'string', 'required'],
          password: ['trim', 'string'],
          otp: ['trim'],
        });

        const validData = validator.validate({
          phone: Math.abs(phone),
          password,
          deviceId,
          trust,
          otp,
        });
        if (!validData) return cb(new ValidationError(validator.getErrors()));

        inputs = validData;
        cb(null);
      },
      // if customer not exists, return error
      (cb) => {
        fetchDB(customersQuery.getOneByPhone, [inputs.phone], (err, result) => {
          if (err) return cb(err);
          if (result.rows.length === 0) return cb(new CustomError('USER_NOT_FOUND'));

          customer = result.rows[0];
          cb(null);
        });
      },
      // check if customer is not blocked
      (cb) => {
        if (customer.is_blocked) {
          const unblockTime = moment(customer.last_login_attempt).add(1, 'minute');
          // if block time is not over, return error
          if (moment().isBefore(unblockTime)) {
            const timeLeft = unblockTime.diff(moment(), 'seconds');
            return cb(new CustomError('USER_BLOCKED', null, { timeLeft }));
          }

          // if block time is over, unblock customer
          customer.last_login_attempt = null;
          customer.is_blocked = false;
        }

        cb(null);
      },
      // determine login type
      (cb) => {
        const { phone, deviceId, otp, password } = inputs;

        fetchDB(devicesQuery.getOneByUid, [deviceId, phone], (err, result) => {
          if (err) return cb(err);

          const loginType = result.rows.length > 0 ? 'otp' : 'password';
          const validator = new LIVR.Validator({
            password: loginType === 'password' ? 'required' : 'string',
            otp: loginType === 'otp' ? 'required' : 'string',
          });

          const validData = validator.validate({ password, otp });
          if (!validData) return cb(new ValidationError(validator.getErrors()));

          cb(null, loginType);
        });
      },
      // check password or otp
      (loginType, cb) => {
        const { password, otp } = inputs;
        if (loginType === 'password') {
          const isPasswordCorrect = bcrypt.compareSync(password, customer.hashed_password);
          cb(null, isPasswordCorrect, loginType);
        } else {
          redis.hGet('otp', customer.phone).then((redisOtp) => {
            if (!redisOtp) return cb(null, false, loginType);
            const otpObject = JSON.parse(redisOtp);

            if (moment().isAfter(otpObject.expiresAt)) {
              redis.hDel('otp', customer.phone);
              return cb(new CustomError('EXPIRED_OTP'));
            }

            if (otpObject.code === parseInt(otp) && moment().isBefore(otpObject.expiresAt)) {
              redis.hDel('otp', customer.phone);
              return cb(null, true, loginType);
            }

            cb(null, false, loginType);
          });
        }
      },
      // if password is wrong
      (isValidCreadentials, loginType, cb) => {
        if (!isValidCreadentials) {
          if (
            customer.last_login_attempt &&
            moment().isBefore(
              moment(customer.last_login_attempt).add(customer.safe_login_after, 'seconds')
            )
          ) {
            // if 3 login attempts in one minute
            customer.is_blocked = true;
            customer.safe_login_after = 0;
          } else {
            // calculate time that customer should wait before next login not to be blocked
            customer.safe_login_after = customer.last_login_attempt
              ? Math.max(60 - moment().diff(customer.last_login_attempt, 'seconds'), 0)
              : 0;
          }

          // save status
          return fetchDB(
            customersQuery.changeStatus,
            [customer.is_blocked, customer.safe_login_after, moment(), customer.id],
            (err) => {
              if (err) return cb(err);

              if (customer.is_blocked) cb(new CustomError('USER_BLOCKED', null, { timeLeft: 60 }));
              else cb(new CustomError(loginType === 'password' ? 'WRONG_PASSWORD' : 'WRONG_OTP'));
            }
          );
        }

        // reset login attempts if password is correct
        fetchDB(customersQuery.changeStatus, [false, 0, null, customer.id]);

        cb(null);
      },
      // if login is successful
      (cb) => {
        async.parallel(
          [
            // trust device if needed
            (cb) => {
              if (inputs.trust)
                fetchDB(devicesQuery.create, [customer.id, inputs.deviceId], (err) => {
                  if (err) return cb(err);
                  cb(null);
                });
              else cb(null);
            },
            // delete old token
            (cb) =>
              redis.hGet('customers', customer.id).then((oldToken) => {
                if (oldToken) redis.hDel('tokens', oldToken);
                cb(null);
              }),
          ],
          () => cb(null)
        );
      },
      // save and return new token
      (cb) => {
        const token = v4();
        async.parallel(
          [
            (cb) => redis.hSet('customers', customer.id, token).then(() => cb(null)),
            (cb) =>
              redis
                .hSet(
                  'tokens',
                  token,
                  JSON.stringify({
                    id: customer.id,
                    role: 'customer',
                    expiresAt: moment().add(1, 'hour').valueOf(),
                  })
                )
                .then(() => cb(null)),
          ],
          (err) => {
            if (err) return cb(err);

            // return customer
            res.status(200).json({
              token,
              customer: {
                id: customer.id,
                name: customer.name,
                phone: customer.phone,
                image_url: imageStorage.getImageUrl('/customer/photo', customer.image_url),
                reg_date: customer.reg_date,
              },
            });

            cb(null);
          }
        );
      },
    ],
    (err) => err && next(err)
  );
}

// @Private
// @Customer
function updateCustomer(req, res, next) {
  let customerId, customer, inputs;

  async.waterfall(
    [
      (cb) => {
        verifyToken(req, 'customer', (err, id) => {
          if (err) return cb(err);

          customerId = id;
          cb(null);
        });
      },
      // validate data
      (cb) => {
        const { name, password, deletePhoto } = req.body;

        const validator = new LIVR.Validator({
          name: ['trim', 'string', { min_length: 3 }, { max_length: 64 }],
          password: ['trim', { min_length: 6 }, 'alphanumeric'],
          deletePhoto: ['trim', 'boolean', { default: false }],
        });

        const validData = validator.validate({ name, password, deletePhoto });
        if (!validData) return cb(new ValidationError(validator.getErrors()));

        inputs = validData;
        cb(null);
      },
      // get customer
      (cb) => {
        fetchDB(customersQuery.getOneById, [customerId], (err, result) => {
          if (err) return cb(err);
          if (result.rows.length === 0) return cb(new CustomError('USER_NOT_FOUND'));

          customer = result.rows[0];
          cb(null);
        });
      },
      // delete old photo if requested or new photo attached
      (cb) => {
        if (!customer.image_url) return cb(null);

        if (inputs.deletePhoto || (req.files && req.files.avatar)) {
          imageStorage.delete(customer.image_url, 'profiles', (err) => {
            if (!err) customer.image_url = null;

            cb(null);
          });
        } else {
          cb(null);
        }
      },
      // save new photo if attached
      (cb) => {
        if (req.files && req.files.avatar) {
          imageStorage.upload(req.files.avatar, 'profiles', (err, newFileName) => {
            if (err) return cb(err);
            cb(null, newFileName);
          });
        } else {
          cb(null, customer.image_url);
        }
      },
      // update customer
      (newFileName, cb) => {
        const { name, password } = inputs;
        const newName = name || customer.name;
        const hashedPassword = password ? bcrypt.hashSync(password, 10) : customer.hashed_password;

        fetchDB(
          customersQuery.update,
          [newName, hashedPassword, newFileName, customer.id],
          (err, result) => {
            if (err) return cb(err);

            customer = result.rows[0];
            customer.image_url = imageStorage.getImageUrl('/customer/photo', customer.image_url);

            res.status(200).json({
              success: true,
              customer,
            });

            cb(null);
          }
        );
      },
    ],
    (err) => err && next(err)
  );
}

// @Public
function getCustomerPhoto(req, res, next) {
  async.waterfall(
    [
      (cb) => {
        const { file } = req.params;

        imageStorage.getPathIfExists(file, 'profiles', (err, filePath) => {
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

      res.send(JSON.parse(otp).code.toString());
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getCustomerProfile,
  registerCustomer,
  getCustomerLoginType,
  getOtpFromSMS,
  loginCustomer,
  updateCustomer,
  getCustomerPhoto,
};
