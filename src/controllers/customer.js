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
const fileStorageS3 = require('../utils/fileStorageS3');
const acceptsLanguages = require('../utils/acceptsLanguages');
const Limiter = require('../utils/limiter');

// @Private
// @Customer
function getCustomerProfile(req, res, next) {
  async.waterfall(
    [
      // verify customer
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
          customer.image_url = fileStorageS3.getFileUrl(customer.image_url);

          cb(null, customer);
        });
      },
    ],
    (err, customer) => {
      if (err) return next(err);
      res.status(200).json(customer);
    }
  );
}

// @Public
function sendCodeToPhone(req, res, next) {
  let inputs, limiter;

  async.waterfall(
    [
      // validate data
      (cb) => {
        const { phone } = req.body;
        const deviceId = req.headers['x-device-id'];

        const validator = new LIVR.Validator({
          phone: ['trim', 'is_phone_number', 'required'],
          deviceId: ['trim', 'string', 'required'],
        });

        const validData = validator.validate({
          phone,
          deviceId,
        });
        if (!validData) return cb(new ValidationError(validator.getErrors()));

        inputs = validData;
        cb(null);
      },
      // check if customer not already exists
      (cb) => {
        fetchDB(customersQuery.getOneByPhone, [inputs.phone], (err, result) => {
          if (err) return cb(err);
          if (result.rows.length > 0) return cb(new CustomError('NUMBER_TAKEN'));

          cb(null);
        });
      },
      // check if sending code is not blocked
      (cb) => {
        limiter = new Limiter('otp_limiter', inputs.deviceId);
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
        // otpService
        //   .sendVerification(inputs.phone, code)
        //   .then(() => cb(null, code))
        //   .catch(cb);
        cb(null, code);
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
          phone: inputs.phone,
          exp: moment().add(5, 'minutes').valueOf(),
          tries: 0,
        };

        redis.hSet('customer_otp', inputs.deviceId, JSON.stringify(value), (err) => {
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
const registerCustomer = (req, res, next) =>
  new Promise((resolve) => {
    let inputs, newCustomer, token;

    async.waterfall(
      [
        // validate data
        (cb) => {
          const { name, phone, password, trust, otp } = req.body;
          const deviceId = req.headers['x-device-id'];

          const validator = new LIVR.Validator({
            name: ['trim', 'string', 'required', { min_length: 3 }, { max_length: 64 }],
            phone: ['trim', 'is_phone_number', 'required'],
            password: ['trim', 'required', { min_length: 6 }, 'alphanumeric'],
            trust: ['boolean', { default: false }],
            deviceId: ['trim', 'string', { required_if: { trust: true } }],
            otp: ['trim', 'required', 'string'],
          });

          const validData = validator.validate({
            name,
            phone: Math.abs(phone),
            password,
            trust,
            deviceId,
            otp,
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
        // check if code is correct
        (cb) => {
          redis.hGet('customer_otp', inputs.deviceId, (err, details) => {
            if (err) return cb(err);
            const detailsObject = JSON.parse(details || '{}');
            const expired = moment().isAfter(moment(detailsObject.exp));
            const tooManyTries = detailsObject.tries >= 3;
            const sameNumber = detailsObject.phone === inputs.phone;
            const sameCode = detailsObject.code === parseInt(inputs.otp);

            if (!details || tooManyTries || !sameCode || !sameNumber || expired) {
              detailsObject.tries += 1;
              redis.hSet('customer_otp', inputs.deviceId, JSON.stringify(detailsObject));

              if (tooManyTries || detailsObject.tries >= 3)
                return cb(new CustomError('TOO_MANY_TRIES'));
              if (expired) return cb(new CustomError('EXPIRED_OTP'));
              return cb(new CustomError('WRONG_OTP'));
            }

            redis.hDel('customer_otp', inputs.deviceId);
            cb(null);
          });
        },
        // create customer
        (cb) => {
          const { name, phone, password } = inputs;
          const hashedPassword = bcrypt.hashSync(password, 10);
          fetchDB(customersQuery.create, [name, phone, hashedPassword], (err, result) => {
            if (err) return cb(err);

            newCustomer = result.rows[0];
            cb(null);
          });
        },
        // save new token
        (cb) => {
          token = v4();
          redis.hSet('customers', newCustomer.id, token, (err) => {
            if (err) return cb(err);
            cb(null);
          });
        },
        (cb) => {
          redis.hSet(
            'tokens',
            token,
            JSON.stringify({
              id: newCustomer.id,
              role: 'customer',
              expiresAt: moment().add(1, 'hour').valueOf(),
            }),
            (err) => {
              if (err) return cb(err);
              cb(null);
            }
          );
        },
        // trust device if needed
        (cb) => {
          if (!inputs.trust) return cb(null);

          const info = getDeviceInfo(req);
          return fetchDB(devicesQuery.create, [newCustomer.id, inputs.deviceId, info], (err) => {
            if (err) return cb(err);

            cb(null);
          });
        },
      ],
      (err) => {
        if (err) {
          // clear
          if (newCustomer) fetchDB(customersQuery.delete, [newCustomer.id]);
          next(err);
        } else {
          // return customer
          res.status(201).json({
            success: true,
            token,
          });
        }
        resolve();
      }
    );
  });

// @Public
function getCustomerLoginType(req, res, next) {
  let inputs, limiter;

  async.waterfall(
    [
      // validate data
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
      // check if sending code is not blocked
      (cb) => {
        limiter = new Limiter('sms_limiter', inputs.deviceId);
        limiter.getStatus((err, status) => {
          if (err) return cb(err);

          const { isBlocked, timeLeft } = status;
          if (isBlocked) return cb(new CustomError('TRY_AGAIN_AFTER', null, { timeLeft }));

          cb(null);
        });
      },
      (cb) => {
        if (!inputs.deviceId) {
          return cb(null, { password: true, otp: false });
        }

        fetchDB(devicesQuery.getOneByUid, [inputs.deviceId, inputs.phone], (err, result) => {
          if (err) return cb(err);

          if (result.rows.length === 0) return cb(null, { password: true, otp: false });

          const otpObject = {
            code: Math.floor(100000 + Math.random() * 900000),
            expiresAt: moment().add(2, 'minutes').valueOf(),
          };

          redis.hSet('customer_otp', inputs.deviceId, JSON.stringify(otpObject), (err) => {
            if (err) return cb(err);

            // TODO: send otp to customer
            cb(null, { password: false, otp: true });
          });
        });
      },
      // record attempt
      (res, cb) => {
        const limiterCb = ({ error }) => {
          if (error) return cb(error);

          cb(null, res);
        };

        limiter.record(true, limiterCb);
      },
    ],
    (err, response) => {
      if (err) return next(err);
      res.json(response);
    }
  );
}

// @Public
const loginCustomer = (req, res, next) =>
  new Promise((resolve) => {
    let inputs, customer, token, limiter, isAlreadyTrusted;

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
          limiter = new Limiter('customer_login_limiter', inputs.deviceId);

          limiter.getStatus((err, status) => {
            if (err) return cb(err);

            const { isBlocked, timeLeft } = status;
            if (isBlocked) return cb(new CustomError('USER_BLOCKED', null, { timeLeft }));

            cb(null);
          });
        },
        // determine login type
        (cb) => {
          const { phone, deviceId, otp, password } = inputs;

          fetchDB(devicesQuery.getOneByUid, [deviceId, phone], (err, result) => {
            if (err) return cb(err);

            isAlreadyTrusted = result.rows.length > 0;
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
          const { password, otp, deviceId } = inputs;
          if (loginType === 'password') {
            const isPasswordCorrect = bcrypt.compareSync(password, customer.hashed_password);
            cb(null, isPasswordCorrect, loginType);
          } else {
            redis.hGet('customer_otp', deviceId, (err, redisOtp) => {
              if (err) return cb(err);
              if (!redisOtp) return cb(null, false, loginType);
              const otpObject = JSON.parse(redisOtp);

              if (moment().isAfter(otpObject.expiresAt)) {
                redis.hDel('customer_otp', customer.phone);
                return cb(new CustomError('EXPIRED_OTP'));
              }

              if (otpObject.code === parseInt(otp) && moment().isBefore(otpObject.expiresAt)) {
                redis.hDel('customer_otp', customer.phone);
                return cb(null, true, loginType);
              }

              cb(null, false, loginType);
            });
          }
        },
        // login with attempts limiter
        (isValidCreadentials, loginType, cb) => {
          const increaseAttempt = isValidCreadentials ? false : true;

          const limiterCb = ({ err, canTryAgain, timeLeft }) => {
            if (isValidCreadentials) return cb(null);

            if (err) return cb(err);
            if (!canTryAgain) return cb(new CustomError('USER_BLOCKED', null, { timeLeft }));

            cb(new CustomError(loginType === 'password' ? 'WRONG_PASSWORD' : 'WRONG_OTP'));
          };

          limiter.record(increaseAttempt, limiterCb);
        },
        // trust device if needed
        (cb) => {
          redis.hDel('customer_otp', inputs.deviceId);

          if (isAlreadyTrusted)
            fetchDB(devicesQuery.updateLastLogin, [inputs.deviceId, customer.id]);

          if (isAlreadyTrusted || !inputs.trust) return cb(null);

          const info = getDeviceInfo(req);
          fetchDB(devicesQuery.create, [customer.id, inputs.deviceId, info], (err) => {
            if (err) return cb(err);
            cb(null);
          });
        },
        // delete old token of this device
        (cb) => {
          redis.hGet('customers', inputs.deviceId, (err, oldToken) => {
            if (err) return cb(err);
            if (oldToken) redis.hDel('tokens', oldToken);
            cb(null);
          });
        },
        // save and return new token
        (cb) => {
          token = v4();
          redis.hSet('customers', inputs.deviceId, token, (err) => {
            if (err) return cb(err);
            cb(null);
          });
        },
        (cb) => {
          redis.hSet(
            'tokens',
            token,
            JSON.stringify({
              id: customer.id,
              role: 'customer',
              expiresAt: moment().add(1, 'hour').valueOf(),
            }),
            (err) => {
              if (err) return cb(err);
              cb(null);
            }
          );
        },
      ],
      (err) => {
        if (err) next(err);
        else res.status(200).json({ token });
        resolve();
      }
    );
  });

// @Private
// @Customer
function updateCustomer(req, res, next) {
  let customerId, customer, inputs, oldImage, newImage, message;

  async.waterfall(
    [
      // verify customer
      (cb) => {
        verifyToken(req, 'customer', (err, id) => {
          if (err) return cb(err);

          customerId = id;
          cb(null);
        });
      },
      // validate data
      (cb) => {
        const { name, password, deleteImage, gender, birthDate } = req.body;

        const validator = new LIVR.Validator({
          name: ['trim', 'string', { min_length: 3 }, { max_length: 64 }],
          password: ['trim', { min_length: 6 }, 'alphanumeric'],
          deleteImage: ['trim', 'boolean', { default: false }],
          gender: ['trim', { one_of: ['M', 'F'] }],
          birthDate: ['trim', 'string', 'past_date'],
        });

        const validData = validator.validate({
          name,
          password,
          deleteImage,
          gender,
          birthDate,
        });
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
      // save new photo if attached
      (cb) => {
        oldImage = customer.image_url;
        if (inputs.deleteImage) customer.image_url = null;
        if (!req.files || !req.files.avatar) return cb(null);

        fileStorageS3.uploadImage(req.files.avatar, 'profiles', (err, newFileName) => {
          if (err) return cb(err);

          newImage = newFileName;
          cb(null);
        });
      },
      // update customer
      (cb) => {
        const { name, password, gender, birthDate } = inputs;
        const newName = name || customer.name;
        const hashedPassword = password ? bcrypt.hashSync(password, 10) : customer.hashed_password;
        const newGender = gender || customer.gender;
        const newBirthDate = birthDate
          ? moment(birthDate, 'DD/MM/YYYY').toISOString()
          : customer.birth_date;
        const newImageUrl = newImage || customer.image_url;

        fetchDB(
          customersQuery.update,
          [newName, hashedPassword, newImageUrl, newGender, newBirthDate, customer.id],
          (err, res) => {
            if (err) return cb(err);

            message = res.rows[0].message[acceptsLanguages(req)];
            cb(null, newImageUrl !== oldImage);
          }
        );
      },
      // delete old image if needed
      (imageChanged, cb) => {
        if (!oldImage || !imageChanged) return cb(null);

        fileStorageS3.delete(oldImage);
        cb(null);
      },
    ],
    (err) => {
      if (err) {
        // clear
        if (newImage) fileStorageS3.delete(newImage);
        return next(err);
      }

      res.status(200).json({
        success: true,
        message,
      });
    }
  );
}

// @Private
// @Customer
function updateCustomerLang(req, res, next) {
  let customerId;

  async.waterfall(
    [
      // verify customer
      (cb) => {
        verifyToken(req, 'customer', (err, id) => {
          if (err) return cb(err);

          customerId = id;
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
      // update customer
      (inputs, cb) => {
        fetchDB(customersQuery.updateLang, [inputs.lang, customerId], (err) => {
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

// @Private
// @Customer
function addServiceToSaved(req, res, next) {
  let customerId, serviceId;

  async.waterfall(
    [
      // verify customer
      (cb) => {
        verifyToken(req, 'customer', (err, id) => {
          if (err) return cb(err);

          customerId = id;
          cb(null);
        });
      },
      // validate data
      (cb) => {
        const { serviceId: id } = req.body;

        const validator = new LIVR.Validator({
          serviceId: ['trim', 'required', 'string'],
        });

        const validData = validator.validate({ serviceId: id });
        if (!validData) return cb(new ValidationError(validator.getErrors()));

        serviceId = validData.serviceId;
        cb(null);
      },
      // add service to saved
      (cb) => {
        fetchDB(customersQuery.addServiceToSaved, [customerId, serviceId], (err) => {
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

// @Private
// @Customer
function removeServiceFromSaved(req, res, next) {
  let customerId, serviceId;

  async.waterfall(
    [
      // verify customer
      (cb) => {
        verifyToken(req, 'customer', (err, id) => {
          if (err) return cb(err);

          customerId = id;
          cb(null);
        });
      },
      // validate data
      (cb) => {
        const { serviceId: id } = req.body;

        const validator = new LIVR.Validator({
          serviceId: ['trim', 'required', 'string'],
        });

        const validData = validator.validate({ serviceId: id });
        if (!validData) return cb(new ValidationError(validator.getErrors()));

        serviceId = validData.serviceId;
        cb(null);
      },
      // remove service from saved
      (cb) => {
        fetchDB(customersQuery.removeServiceFromSaved, [customerId, serviceId], (err) => {
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

// @Private
// @Customer
function getAllDevices(req, res, next) {
  let customerId;

  async.waterfall(
    [
      // verify customer
      (cb) => {
        verifyToken(req, 'customer', (err, id) => {
          if (err) return cb(err);

          customerId = id;
          cb(null);
        });
      },
      // get all devices
      (cb) => {
        fetchDB(devicesQuery.getAllByCustomer, [customerId], (err, result) => {
          if (err) return cb(err);

          const devices = {
            count: result.rowCount,
            rows: result.rows,
          };

          cb(null, devices);
        });
      },
    ],
    (err, devices) => {
      if (err) return next(err);

      res.status(200).json(devices);
    }
  );
}

// @Private
// @Customer
function untrustDevice(req, res, next) {
  async.waterfall(
    [
      // verify customer
      (cb) => {
        verifyToken(req, 'customer', (err, id) => {
          if (err) return cb(err);

          cb(null, id);
        });
      },
      // delete device
      (customerId, cb) => {
        const deviceId = req.params.deviceId;
        fetchDB(devicesQuery.remove, [deviceId, customerId], (err) => {
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

// @Helper
function getDeviceInfo(req) {
  let { browser, version, os, platform } = req.useragent;

  platform = platform === 'unknown' ? '' : platform;
  os = os === 'unknown' ? '' : os;

  return `${platform} ${os} ${browser} ${version}`.trim();
}

// FAKE OTP GETTER
function getOtpFromSMS(req, res, next) {
  try {
    const deviceId = req.headers['x-device-id'];

    redis.hGet('customer_otp', deviceId, (err, otp) => {
      if (err) console.error(err);
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
  updateCustomerLang,
  addServiceToSaved,
  removeServiceFromSaved,
  sendCodeToPhone,
  untrustDevice,
  getAllDevices,
};
