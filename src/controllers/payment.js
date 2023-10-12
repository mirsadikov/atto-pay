const async = require('async');
const verifyToken = require('../middleware/verifyToken');
const LIVR = require('../utils/livr');
const fetchDB = require('../postgres');
const ValidationError = require('../errors/ValidationError');
const CustomError = require('../errors/CustomError');
const { paymentsQuery } = require('../postgres/queries');

// @Private
// @Customer
function payForService(req, res, next) {
  let customerId, inputs;

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
        const { serviceId, fromCardId } = req.body;

        const validator = new LIVR.Validator({
          serviceId: ['trim', 'required', 'string'],
          fromCardId: ['trim', 'required', 'string'],
        });

        const validData = validator.validate({ serviceId, fromCardId });

        if (!validData) return cb(new ValidationError(validator.getErrors()));

        inputs = validData;
        cb(null);
      },
      // pay for service
      (cb) => {
        fetchDB(
          paymentsQuery.payForService,
          [customerId, inputs.fromCardId, inputs.serviceId],
          (err, result) => {
            if (err) return cb(err);

            const { error_code, error_message, transaction_id } = result.rows[0];

            if (error_code) return cb(new CustomError(error_code, error_message));

            cb(null, transaction_id);
          }
        );
      },
    ],
    (err, transaction_id) => {
      if (err) return next(err);

      res.status(200).json({ success: true, transaction_id });
    }
  );
}

module.exports = {
  payForService,
};
