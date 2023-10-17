const async = require('async');
const moment = require('moment');
const imageStorage = require('../utils/imageStorage');
const verifyToken = require('../middleware/verifyToken');
const LIVR = require('../utils/livr');
const fetchDB = require('../postgres');
const ValidationError = require('../errors/ValidationError');
const CustomError = require('../errors/CustomError');
const { transactionsQuery } = require('../postgres/queries');

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
          transactionsQuery.payForService,
          [customerId, inputs.fromCardId, inputs.serviceId],
          (err, result) => {
            if (err) return cb(err);

            const { error_code, error_message, payment_id } = result.rows[0];

            if (error_code) return cb(new CustomError(error_code, error_message));

            cb(null, payment_id);
          }
        );
      },
    ],
    (err, payment_id) => {
      if (err) return next(err);

      res.status(200).json({ success: true, payment_id });
    }
  );
}

// @Private
// @Customer
function transferMoney(req, res, next) {
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
        const { toCardPan, fromCardId, amount } = req.body;

        const validator = new LIVR.Validator({
          fromCardId: ['trim', 'required', 'string'],
          toCardPan: ['required', 'valid_pan'],
          amount: ['required', 'positive_integer'],
        });

        const validData = validator.validate({ toCardPan, fromCardId, amount });

        if (!validData) return cb(new ValidationError(validator.getErrors()));

        inputs = validData;
        cb(null);
      },
      // transfer money
      (cb) => {
        fetchDB(
          transactionsQuery.transferMoney,
          [customerId, inputs.fromCardId, inputs.toCardPan, inputs.amount],
          (err, result) => {
            if (err) return cb(err);

            const { error_code, error_message, transfer_id } = result.rows[0];

            if (error_code) return cb(new CustomError(error_code, error_message));

            cb(null, transfer_id);
          }
        );
      },
    ],
    (err, transfer_id) => {
      if (err) return next(err);

      res.status(200).json({ success: true, transfer_id });
    }
  );
}

// @Private
// @Customer
function transferMoneyToSelf(req, res, next) {
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
        const { fromCardId, toCardId, amount } = req.body;

        const validator = new LIVR.Validator({
          fromCardId: ['trim', 'required', 'string'],
          toCardId: ['trim', 'required', 'string'],
          amount: ['required', 'positive_integer'],
        });

        const validData = validator.validate({ fromCardId, toCardId, amount });

        if (!validData) return cb(new ValidationError(validator.getErrors()));

        inputs = validData;
        cb(null);
      },
      // transfer money
      (cb) => {
        fetchDB(
          transactionsQuery.transferMoneyToSelf,
          [customerId, inputs.fromCardId, inputs.toCardId, inputs.amount],
          (err, result) => {
            if (err) return cb(err);

            const { error_code, error_message, transfer_id } = result.rows[0];

            if (error_code) return cb(new CustomError(error_code, error_message));

            cb(null, transfer_id);
          }
        );
      },
    ],
    (err, transfer_id) => {
      if (err) return next(err);

      res.status(200).json({ success: true, transfer_id });
    }
  );
}

// @Private
// @Customer
function getTransactions(req, res, next) {
  let customerId, inputs, transactions;

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
        const { offset, fromDate, toDate, byCardId = null, byServiceId = null } = req.body;

        const validator = new LIVR.Validator({
          offset: ['trim', 'required', 'decimal', { number_between: [-12, 12] }],
          fromDate: ['trim', 'required', 'string', { past_date: offset }],
          toDate: ['trim', 'required', 'string', { past_date: offset }],
          byCardId: ['trim', 'string'],
          byServiceId: ['trim', 'string'],
        });

        const validData = validator.validate({ offset, fromDate, toDate, byCardId, byServiceId });

        if (!validData) return cb(new ValidationError(validator.getErrors()));

        inputs = validData;
        cb(null);
      },
      // get transactions
      (cb) => {
        const offset = inputs.offset;
        inputs.fromDate = moment(inputs.fromDate, 'DD/MM/YYYY')
          .startOf('day')
          .add(offset, 'hours')
          .toISOString();
        inputs.toDate = moment(inputs.toDate, 'DD/MM/YYYY')
          .endOf('day')
          .add(offset, 'hours')
          .toISOString();

        fetchDB(
          transactionsQuery.getTransactions,
          [customerId, inputs.fromDate, inputs.toDate, inputs.byCardId, inputs.byServiceId],
          (err, result) => {
            if (err) return cb(err);

            transactions = result.rows;
            cb(null);
          }
        );
      },
      (cb) => {
        transactions.forEach((t) => {
          if (t.sender.image_url) t.sender.image_url = imageStorage.getImageUrl(t.sender.image_url);

          if (t.receiver.image_url)
            t.receiver.image_url = imageStorage.getImageUrl(t.receiver.image_url);
        });

        cb(null);
      },
    ],
    (err) => {
      if (err) return next(err);

      res.status(200).json({ length: transactions.length, transactions });
    }
  );
}

module.exports = {
  payForService,
  transferMoney,
  transferMoneyToSelf,
  getTransactions,
};
