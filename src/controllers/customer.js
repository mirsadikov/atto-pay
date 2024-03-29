const async = require('async');
const v4 = require('uuid').v4;
const moment = require('moment');
const bcrypt = require('bcrypt');
const fetchDB = require('../postgres');
const redis = require('../redis');
const io = require('../socket/socket');
const { customersQuery, devicesQuery, messagesQuery } = require('../postgres/queries');
const verifyToken = require('../middleware/verifyToken');
const LIVR = require('../utils/livr');
const ValidationError = require('../errors/ValidationError');
const CustomError = require('../errors/CustomError');
const fileStorageS3 = require('../utils/fileStorageS3');
const acceptsLanguages = require('../utils/acceptsLanguages');
const Limiter = require('../utils/limiter');
const smsService = require('../utils/smsService');

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
        limiter = new Limiter('sms_limiter', inputs.deviceId);
        limiter.getStatus((err, status) => {
          if (err) return cb(err);

          const { isBlocked, timeLeft } = status;
          if (isBlocked) return cb(new CustomError('TRY_AGAIN_AFTER', null, { timeLeft }));

          cb(null);
        });
      },
      // send code
      (cb) => {
        const code = Math.floor(100000 + Math.random() * 900000);
        smsService
          .sendVerification(inputs.phone, code)
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
              exp: moment().add(1, 'hour').valueOf(),
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
        const { phone, trust } = req.body;
        const deviceId = req.headers['x-device-id'];

        const validator = new LIVR.Validator({
          phone: ['trim', 'is_phone_number', 'required'],
          trust: ['boolean', { default: false }],
          deviceId: ['trim', 'string', 'required'],
        });

        const validData = validator.validate({ deviceId, trust, phone: Math.abs(phone) });
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
      // check if device is already trusted
      (cb) => {
        fetchDB(devicesQuery.getOneByUid, [inputs.deviceId, inputs.phone], (err, result) => {
          if (err) return cb(err);
          const alreadyTrusted = result.rows.length > 0;
          cb(null, alreadyTrusted);
        });
      },
      // if trusted or want to trust, send code
      (alreadyTrusted, cb) => {
        const { phone, deviceId, trust } = inputs;
        if (!alreadyTrusted && !trust) return cb(null, { password: true, otp: false });

        limiter = new Limiter('sms_limiter', deviceId);
        limiter.getStatus((err, status) => {
          if (err) return cb(err);

          // check if sending code is not blocked
          const { isBlocked, timeLeft } = status;
          if (isBlocked) return cb(new CustomError('TRY_AGAIN_AFTER', null, { timeLeft }));

          const code = Math.floor(100000 + Math.random() * 900000);
          const otpObject = {
            code,
            exp: moment().add(2, 'minutes').valueOf(),
            phone: phone,
            newDevice: !alreadyTrusted,
          };

          // save code
          redis.hSet('customer_otp', deviceId, JSON.stringify(otpObject), (err) => {
            if (err) return cb(err);

            smsService
              .sendVerification(phone, code)
              .then(() => cb(null, { password: !alreadyTrusted, otp: true, timeLeft: 120 }))
              .catch(cb);
          });
        });
      },
      // record attempt for sending code if code is sent
      (res, cb) => {
        if (!res.otp) return cb(null, res);

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
    let inputs, customer, token, limiter, isAlreadyTrusted, newDevice;

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
          const { phone, deviceId, trust } = inputs;

          fetchDB(devicesQuery.getOneByUid, [deviceId, phone], (err, result) => {
            if (err) return cb(err);

            isAlreadyTrusted = result.rows.length > 0;
            const loginType = isAlreadyTrusted || trust ? 'otp' : 'password';
            cb(null, loginType);
          });
        },
        // check password or otp
        (loginType, cb) => {
          const { phone, password, otp, deviceId } = inputs;
          if (loginType === 'password') {
            const validator = new LIVR.Validator({ password: ['required', 'string'] });
            const validData = validator.validate({ password });
            if (!validData) return cb(new ValidationError(validator.getErrors()));

            const isPasswordCorrect = bcrypt.compareSync(
              validData.password,
              customer.hashed_password
            );

            cb(null, isPasswordCorrect, loginType);
          } else {
            redis.hGet('customer_otp', deviceId, (err, redisOtp) => {
              if (err) return cb(err);
              const detailsObject = JSON.parse(redisOtp || '{}');

              // validate required fields
              newDevice = detailsObject.newDevice;
              const passwordRequired = !isAlreadyTrusted && newDevice;
              const validator = new LIVR.Validator({
                otp: 'required',
                password: passwordRequired ? 'required' : 'string',
              });
              const validData = validator.validate({ password, otp });
              if (!validData) return cb(new ValidationError(validator.getErrors()));

              const expired = moment().isAfter(moment(detailsObject.exp));
              const sameNumber = detailsObject.phone === phone;
              const sameCode = detailsObject.code === parseInt(otp);
              const samePassword = passwordRequired
                ? bcrypt.compareSync(validData.password, customer.hashed_password)
                : true;

              if (!redisOtp || !sameCode || !sameNumber || expired || !samePassword) {
                if (expired) {
                  redis.hDel('customer_otp', deviceId);
                  return cb(new CustomError('EXPIRED_OTP'));
                }

                return cb(null, false, !sameCode ? 'otp' : 'password');
              }

              redis.hDel('customer_otp', inputs.deviceId);
              cb(null, true, null);
            });
          }
        },
        // login with attempts limiter
        (isValidCreadentials, wrongFieldType, cb) => {
          const increaseAttempt = isValidCreadentials ? false : true;

          const limiterCb = ({ err, canTryAgain, timeLeft }) => {
            if (isValidCreadentials) return cb(null);

            if (err) return cb(err);
            if (!canTryAgain) return cb(new CustomError('USER_BLOCKED', null, { timeLeft }));

            cb(new CustomError(wrongFieldType === 'password' ? 'WRONG_PASSWORD' : 'WRONG_OTP'));
          };

          limiter.record(increaseAttempt, limiterCb);
        },
        // trust device if needed
        (cb) => {
          redis.hDel('customer_otp', inputs.deviceId);

          if (isAlreadyTrusted)
            fetchDB(devicesQuery.updateLastLogin, [inputs.deviceId, customer.id]);

          if (isAlreadyTrusted) return cb(null);

          if (newDevice && inputs.trust) {
            const info = getDeviceInfo(req);
            fetchDB(devicesQuery.create, [customer.id, inputs.deviceId, info], (err) => {
              if (err) return cb(err);
              cb(null);
            });
          } else {
            cb(null);
          }
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
              exp: moment().add(1, 'hour').valueOf(),
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
function allowLoginByQR(req, res, next) {
  let inputs, token, customerId, qrLoginObject;

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
      // allow login by qr
      (cb) => {
        const { key, allowDeviceId } = req.body;

        const validator = new LIVR.Validator({
          key: ['trim', 'required', 'string'],
          allowDeviceId: ['trim', 'required', 'string'],
        });

        const validData = validator.validate({ key, allowDeviceId });

        if (!validData) return cb(new ValidationError(validator.getErrors()));

        inputs = validData;
        cb(null);
      },
      // get qr login data
      (cb) => {
        redis.hGet('qr_login', inputs.key, (err, qrLoginData) => {
          if (err) return cb(err);
          if (!qrLoginData) return cb(new CustomError('INVALID_REQUEST'));

          qrLoginObject = JSON.parse(qrLoginData);

          if (qrLoginObject.deviceId !== inputs.allowDeviceId)
            return cb(new CustomError('INVALID_REQUEST'));

          if (moment().isAfter(moment(qrLoginObject.exp)))
            return cb(new CustomError('EXPIRED_QR_LOGIN'));

          cb(null);
        });
      },
      // allow login
      (cb) => {
        token = v4();
        redis.hDel('qr_login', inputs.key);
        redis.hDel('qr_login', inputs.allowDeviceId);
        redis.hSet('customers', inputs.allowDeviceId, token, (err) => {
          if (err) return cb(err);

          cb(null);
        });
      },
      (cb) => {
        redis.hSet(
          'tokens',
          token,
          JSON.stringify({
            id: customerId,
            role: 'customer',
            exp: moment().add(1, 'hour').valueOf(),
          }),
          (err) => {
            if (err) return cb(err);
            cb(null);
          }
        );
      },
      // get success message
      (cb) => {
        fetchDB(messagesQuery.get, ['QR_LOGIN_SUCCESS', acceptsLanguages(req)], (err, result) => {
          if (err) return cb(err);

          cb(null, result.rows[0]);
        });
      },
    ],
    (err, message) => {
      if (err) {
        inputs.allowDeviceId && io.to(qrLoginObject.socketId).emit('qr_login_deny', { error: err });
        return next(err);
      }

      res.status(message.http_code).json({ success: true, message: message.message });
      io.to(qrLoginObject.socketId).emit('qr_login_allow', { token });
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
  allowLoginByQR,
};
