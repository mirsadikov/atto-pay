const async = require('async');
const fetchDB = require('../postgres');
const { devicesQuery, messagesQuery } = require('../postgres/queries');
const verifyToken = require('../middleware/verifyToken');
const CustomError = require('../errors/CustomError');
const redis = require('../redis');
const ValidationError = require('../errors/ValidationError');
const LIVR = require('../utils/livr');
const acceptsLanguages = require('../utils/acceptsLanguages');

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
  let message;

  async.waterfall(
    [
      // verify customer
      (cb) => {
        verifyToken(req, 'customer', (err, id) => {
          if (err) return cb(err);

          cb(null, id);
        });
      },
      // check if current device is trusted
      (customerId, cb) => {
        const deviceId = req.headers['x-device-id'];
        fetchDB(devicesQuery.getOnyByCustomer, [deviceId, customerId], (err, result) => {
          if (err) return cb(err);
          if (result.rows.length === 0) return cb(new CustomError('ALLOWED_FOR_TRUSTED'));

          cb(null, customerId);
        });
      },
      // delete device
      (customerId, cb) => {
        const deviceId = req.body.deviceId;
        fetchDB(devicesQuery.remove, [deviceId, customerId], (err, res) => {
          if (err) return cb(err);

          message = res.rows[0].message[acceptsLanguages(req)];

          cb(null);
        });
      },
    ],
    (err) => {
      if (err) return next(err);

      res.status(200).json({
        success: true,
        message,
      });
    }
  );
}

// @Private
// @Customer
function endOtherSessions(req, res, next) {
  let customerId, inputs, message;

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
      // validate
      (cb) => {
        const deviceId = req.headers['x-device-id'];

        const validator = new LIVR.Validator({
          deviceId: ['required', 'string'],
        });

        const validData = validator.validate({ deviceId });
        if (!validData) return cb(new ValidationError(validator.getErrors()));

        inputs = validData;
        cb(null);
      },
      // check if current device is trusted
      (cb) => {
        fetchDB(devicesQuery.getOnyByCustomer, [inputs.deviceId, customerId], (err, result) => {
          if (err) return cb(err);
          if (result.rows.length === 0) return cb(new CustomError('ALLOWED_FOR_TRUSTED'));

          cb(null);
        });
      },
      // remove tokens from redis
      (cb) => {
        redis.hGetAll('customers', (err, result) => {
          if (err) return cb(err);

          const keys = Object.keys(result);
          const promises = [];

          keys.forEach((key) => {
            if (key !== inputs.deviceId) {
              promises.push(redis.hDel('tokens', result[key]));
              promises.push(redis.hDel('customers', key));
            }
          });

          Promise.all(promises)
            .then(() => cb(null))
            .catch((err) => cb(err));
        });
      },
      // get success message
      (cb) => {
        fetchDB(messagesQuery.get, ['SESSIONS_ENDED', acceptsLanguages(req)], (err, result) => {
          if (err) return cb(err);

          message = result.rows[0];
          cb(null);
        });
      },
    ],
    (err) => {
      if (err) return next(err);

      res.status(message.http_code).json({ success: true, message: message.message });
    }
  );
}

module.exports = {
  untrustDevice,
  getAllDevices,
  endOtherSessions,
};
