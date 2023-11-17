const async = require('async');
const moment = require('moment');
const fileStorage = require('../utils/fileStorageS3');
const verifyToken = require('../middleware/verifyToken');
const LIVR = require('../utils/livr');
const fetchDB = require('../postgres');
const ValidationError = require('../errors/ValidationError');
const CustomError = require('../errors/CustomError');
const { transactionsQuery } = require('../postgres/queries');
const acceptsLanguages = require('../utils/acceptsLanguages');

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
        const { serviceId, fromCardId, amount, fields } = req.body;

        const validator = new LIVR.Validator({
          serviceId: ['trim', 'required', 'string'],
          fromCardId: ['trim', 'required', 'string'],
          amount: ['required', 'integer', { min_number: 1 }],
          fields: ['any_object'],
        });

        const validData = validator.validate({
          serviceId,
          fromCardId,
          amount: Math.abs(amount),
          fields,
        });

        if (!validData) return cb(new ValidationError(validator.getErrors()));

        inputs = validData;
        cb(null);
      },
      // pay for service
      (cb) => {
        fetchDB(
          transactionsQuery.payForService,
          [
            customerId,
            inputs.fromCardId,
            inputs.serviceId,
            inputs.amount,
            JSON.stringify(inputs.fields || {}),
          ],
          (err, result) => {
            if (err) return cb(err);

            const { error_code, error_message, payment_id, success_message } = result.rows[0];

            if (error_code) return cb(new CustomError(error_code, error_message));

            const message = success_message[acceptsLanguages(req)];
            cb(null, payment_id, message);
          }
        );
      },
    ],
    (err, payment_id, message) => {
      if (err) return next(err);

      res.status(200).json({ success: true, payment_id, message });
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

            const { error_code, error_message, transfer_id, success_message } = result.rows[0];

            if (error_code) return cb(new CustomError(error_code, error_message));

            const message = success_message[acceptsLanguages(req)];
            cb(null, transfer_id, message);
          }
        );
      },
    ],
    (err, transfer_id, message) => {
      if (err) return next(err);

      res.status(200).json({ success: true, transfer_id, message });
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

        if (fromCardId === toCardId) return cb(new CustomError('SAME_CARD'));

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

            const { error_code, error_message, transfer_id, success_message } = result.rows[0];

            if (error_code) return cb(new CustomError(error_code, error_message));

            const message = success_message[acceptsLanguages(req)];
            cb(null, transfer_id, message);
          }
        );
      },
    ],
    (err, transfer_id, message) => {
      if (err) return next(err);

      res.status(200).json({ success: true, transfer_id, message });
    }
  );
}

// @Private
// @Customer
function getTransactions(req, res, next) {
  let customerId, inputs, transactions, total_count;

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
        const {
          offset,
          fromDate,
          toDate,
          page,
          limit,
          byCardId = null,
          byServiceId = null,
        } = req.body;

        const validator = new LIVR.Validator({
          offset: ['trim', 'required', 'decimal', { number_between: [-12, 12] }],
          fromDate: ['trim', 'required', 'string', { past_date: offset }],
          toDate: ['trim', 'required', 'string', { past_date: offset }],
          page: ['positive_integer'],
          limit: ['positive_integer'],
          byCardId: ['trim', 'string'],
          byServiceId: ['trim', 'string'],
        });

        const validData = validator.validate({
          offset,
          fromDate,
          toDate,
          page: page || 1,
          limit: limit || 20,
          byCardId,
          byServiceId,
        });

        if (!validData) return cb(new ValidationError(validator.getErrors()));

        inputs = validData;
        cb(null);
      },
      // get transactions
      (cb) => {
        let { offset, fromDate, toDate, page, limit, byCardId, byServiceId } = inputs;

        fromDate = moment(inputs.fromDate, 'DD/MM/YYYY')
          .startOf('day')
          .add(offset, 'hours')
          .toISOString();
        toDate = moment(inputs.toDate, 'DD/MM/YYYY')
          .endOf('day')
          .add(offset, 'hours')
          .toISOString();

        fetchDB(
          transactionsQuery.getTransactions,
          [customerId, fromDate, toDate, page, limit, byCardId, byServiceId],
          (err, result) => {
            if (err) return cb(err);

            transactions = result.rows;
            total_count = transactions[0] ? transactions[0].total_count : transactions.length;
            cb(null);
          }
        );
      },
      (cb) => {
        transactions.forEach((t) => {
          delete t.total_count;

          if (t.sender.image_url) t.sender.image_url = fileStorage.getFileUrl(t.sender.image_url);

          if (t.receiver.image_url)
            t.receiver.image_url = fileStorage.getFileUrl(t.receiver.image_url);
        });

        cb(null);
      },
    ],
    (err) => {
      if (err) return next(err);

      res.status(200).json({ total_count, length: transactions.length, transactions });
    }
  );
}

// @Private
// @Customer
function getOneTransaction(req, res, next) {
  let customerId, inputs, transaction;

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
        const { transactionId, type } = req.params;

        const validator = new LIVR.Validator({
          transactionId: ['trim', 'required', 'string'],
          type: ['trim', 'required', 'string', { one_of: ['payment', 'transfer'] }],
        });

        const validData = validator.validate({ transactionId, type });
        if (!validData) return cb(new ValidationError(validator.getErrors()));

        inputs = validData;
        cb(null);
      },
      // get transaction
      (cb) => {
        fetchDB(
          transactionsQuery.getOneById,
          [customerId, inputs.transactionId, inputs.type],
          (err, result) => {
            if (err) return cb(err);

            if (!result.rows[0]) return cb(new CustomError('TRANSACTION_NOT_FOUND'));

            transaction = result.rows[0];

            if (transaction.sender.image_url)
              transaction.sender.image_url = fileStorage.getFileUrl(transaction.sender.image_url);

            if (transaction.receiver.image_url)
              transaction.receiver.image_url = fileStorage.getFileUrl(
                transaction.receiver.image_url
              );

            cb(null);
          }
        );
      },
    ],
    (err) => {
      if (err) return next(err);

      res.status(200).json(transaction);
    }
  );
}

module.exports = {
  payForService,
  transferMoney,
  transferMoneyToSelf,
  getTransactions,
  getOneTransaction,
};
