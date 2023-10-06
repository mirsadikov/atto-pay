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
          customer.image_url = imageStorage.getImageUrl(customer.image_url);

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
function registerCustomer(req, res, next) {
  let inputs, newCustomer, token;

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
        if (inputs.trust)
          return fetchDB(devicesQuery.create, [newCustomer.id, inputs.deviceId], (err) => {
            if (err) return cb(err);

            cb(null);
          });

        cb(null);
      },
    ],
    (err) => {
      if (err) {
        // clear
        if (newCustomer) fetchDB(customersQuery.delete, [newCustomer.id, newCustomer.phone]);
        return next(err);
      }

      // return customer
      res.status(201).json({
        success: true,
        token,
        customer: newCustomer,
      });
    }
  );
}

// @Public
function getCustomerLoginType(req, res, next) {
  let inputs;

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

          redis.hSet('otp', inputs.phone, JSON.stringify(otpObject), (err) => {
            if (err) return cb(err);

            // TODO: send otp to customer
            cb(null, { password: false, otp: true });
          });
        });
      },
    ],
    (err, response) => {
      if (err) return next(err);
      res.json(response);
    }
  );
}

// @Public
function loginCustomer(req, res, next) {
  let inputs,
    customer,
    token,
    customerStatus = {};

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
        redis.hGet('customer_login', inputs.phone, (err, loginObject) => {
          if (err) return cb(err);
          if (!loginObject) return cb(null);

          customerStatus = JSON.parse(loginObject);
          if (customerStatus.is_blocked) {
            const unblockTime = moment(customerStatus.last_login_attempt).add(1, 'minute');
            // if block time is not over, return error
            if (moment().isBefore(unblockTime)) {
              const timeLeft = unblockTime.diff(moment(), 'seconds');
              return cb(new CustomError('USER_BLOCKED', null, { timeLeft }));
            }

            // if block time is over, unblock customer
            customerStatus.last_login_attempt = null;
            customerStatus.is_blocked = false;
          }

          cb(null);
        });
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
          redis.hGet('otp', customer.phone, (err, redisOtp) => {
            if (err) return cb(err);
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
            customerStatus.last_login_attempt &&
            moment().isBefore(
              moment(customerStatus.last_login_attempt).add(
                customerStatus.safe_login_after,
                'seconds'
              )
            )
          ) {
            // if 3 login attempts in one minute
            customerStatus.is_blocked = true;
            customerStatus.safe_login_after = 0;
          } else {
            // calculate time that customer should wait before next login not to be blocked
            customerStatus.safe_login_after = customerStatus.last_login_attempt
              ? Math.max(60 - moment().diff(customerStatus.last_login_attempt, 'seconds'), 0)
              : 0;
          }

          customerStatus.last_login_attempt = moment();
          // save status
          return redis.hSet(
            'customer_login',
            customer.phone,
            JSON.stringify(customerStatus),
            (err) => {
              if (err) return cb(err);

              if (customerStatus.is_blocked)
                cb(new CustomError('USER_BLOCKED', null, { timeLeft: 60 }));
              else cb(new CustomError(loginType === 'password' ? 'WRONG_PASSWORD' : 'WRONG_OTP'));
            }
          );
        }

        // reset login attempts if password is correct
        redis.hDel('customer_login', customer.phone);

        cb(null);
      },
      // trust device if needed
      (cb) => {
        if (!inputs.trust) return cb(null);

        fetchDB(devicesQuery.create, [customer.id, inputs.deviceId], (err) => {
          if (err) return cb(err);
          cb(null);
        });
      },
      // delete old token
      (cb) => {
        redis.hGet('customers', customer.id, (err, oldToken) => {
          if (err) return cb(err);
          if (oldToken) redis.hDel('tokens', oldToken);
          cb(null);
        });
      },
      // save and return new token
      (cb) => {
        token = v4();
        redis.hSet('customers', customer.id, token, (err) => {
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
      if (err) return next(err);

      // return customer
      res.status(200).json({
        token,
        customer: {
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
          image_url: imageStorage.getImageUrl(customer.image_url),
          reg_date: customer.reg_date,
        },
      });
    }
  );
}

// @Private
// @Customer
function updateCustomer(req, res, next) {
  let customerId, customer, inputs, oldImage, newImage;

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
          birthDate: ['trim', 'valid_date'],
        });

        const validData = validator.validate({ name, password, deleteImage, gender, birthDate });
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

        imageStorage.upload(req.files.avatar, 'profiles', (err, newFileName) => {
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
        const newBirthDate = birthDate || customer.birth_date;
        const newImageUrl = newImage || customer.image_url;

        fetchDB(
          customersQuery.update,
          [newName, hashedPassword, newImageUrl, newGender, newBirthDate, customer.id],
          (err, result) => {
            if (err) return cb(err);

            customer = result.rows[0];
            customer.image_url = imageStorage.getImageUrl(customer.image_url);

            cb(null, newImageUrl !== oldImage);
          }
        );
      },
      // delete old image if needed
      (imageChanged, cb) => {
        if (!oldImage || !imageChanged) return cb(null);

        imageStorage.delete(oldImage);
        cb(null);
      },
    ],
    (err) => {
      if (err) {
        // clear
        if (newImage) imageStorage.delete(newImage);
        return next(err);
      }

      res.status(200).json({
        success: true,
        customer,
      });
    }
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
          cb(null, filePath);
        });
      },
    ],
    (err, file) => {
      if (err) return next(err);
      res.sendFile(file);
    }
  );
}

// FAKE OTP GETTER
function getOtpFromSMS(req, res, next) {
  try {
    const { phone } = req.params;

    redis.hGet('otp', phone, (err, otp) => {
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
  getCustomerPhoto,
};
