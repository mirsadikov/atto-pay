const async = require('async');
const moment = require('moment');
const verifyToken = require('../middleware/verifyToken');
const LIVR = require('../utils/livr');
const { cardsQuery } = require('../postgres/queries');
const fetchDB = require('../postgres');
const ValidationError = require('../errors/ValidationError');
const CustomError = require('../errors/CustomError');

// @Private
// @Customer
function createCard(req, res, next) {
  async.waterfall(
    [
      // verify customer
      (cb) => {
        verifyToken(req, 'customer', (err, customerId) => {
          if (err) return cb(err);
          cb(null, customerId);
        });
      },
      // validate data
      (customerId, cb) => {
        const { name, pan, expiry_month, expiry_year } = req.body;

        const validator = new LIVR.Validator({
          name: ['trim', 'string', 'required', { min_length: 2 }, { max_length: 64 }],
          pan: ['positive_integer', 'required', { length_equal: 16 }],
          expiry_month: ['positive_integer', 'required', { min_length: 1 }, { max_length: 2 }],
          expiry_year: ['positive_integer', 'required', { min_length: 1 }, { max_length: 2 }],
        });

        const validData = validator.validate({ name, pan, expiry_month, expiry_year });
        if (!validData) return cb(new ValidationError(validator.getErrors()));

        // check card expiry date is valid and not expired
        const expiryDate = moment(`${validData.expiry_month}/${validData.expiry_year}`, 'MM/YY');
        if (!expiryDate.isValid()) return cb(new CustomError('INVALID_EXPIRY_DATE'));
        if (expiryDate.isBefore(moment())) return cb(new CustomError('CARD_EXPIRED'));

        cb(null, customerId, validData);
      },
      // check card is not already added
      (customerId, validData, cb) => {
        fetchDB(cardsQuery.getOneByPan, [validData.pan], (err, result) => {
          if (err) return cb(err);
          if (result.rows.length > 0) return cb(new CustomError('CARD_ALREADY_ADDED'));

          cb(null, customerId, validData);
        });
      },
      // create card
      (customerId, validData, cb) => {
        fetchDB(
          cardsQuery.create,
          [
            customerId,
            validData.name,
            validData.pan,
            validData.expiry_month,
            validData.expiry_year,
          ],
          (err, result) => {
            if (err) return cb(err);

            res.status(201).json({
              success: true,
              card: result.rows[0],
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
function getCustomerCards(req, res, next) {
  async.waterfall(
    [
      // verify customer
      (cb) => {
        verifyToken(req, 'customer', (err, customerId) => {
          if (err) return cb(err);
          cb(null, customerId);
        });
      },
      // get cards
      (customerId, cb) => {
        fetchDB(cardsQuery.getAllByCustomerId, [customerId], (err, result) => {
          if (err) return cb(err);

          res.status(200).json({
            count: result.rowCount,
            cards: result.rows,
          });
          cb(null);
        });
      },
    ],
    (err) => err && next(err)
  );
}

// @Private
// @Customer
function updateCard(req, res, next) {
  async.waterfall(
    [
      // verify customer
      (cb) => {
        verifyToken(req, 'customer', (err, customerId) => {
          if (err) return cb(err);
          cb(null, customerId);
        });
      },
      // validate data
      (customerId, cb) => {
        const { id, name } = req.body;

        const validator = new LIVR.Validator({
          id: ['trim', 'string', 'required'],
          name: ['trim', 'string', 'required', { min_length: 2 }, { max_length: 64 }],
        });

        const validData = validator.validate({ id, name });
        if (!validData) return cb(new ValidationError(validator.getErrors()));

        cb(null, customerId, validData);
      },
      // update card
      (customerId, data, cb) => {
        fetchDB(cardsQuery.update, [data.name, data.id, customerId], (err, result) => {
          if (err) return cb(err);
          if (result.rowCount === 0) return cb(new CustomError('CARD_NOT_FOUND'));

          res.status(200).json({
            success: true,
            card: result.rows[0],
          });
          cb(null);
        });
      },
    ],
    (err) => err && next(err)
  );
}

// @Private
// @Customer
function deleteCard(req, res, next) {
  async.waterfall(
    [
      // verify customer
      (cb) => {
        verifyToken(req, 'customer', (err, customerId) => {
          if (err) return cb(err);
          cb(null, customerId);
        });
      },
      // validate data
      (customerId, cb) => {
        const { id } = req.body;

        const validator = new LIVR.Validator({
          id: ['trim', 'string', 'required'],
        });

        const validData = validator.validate({ id });
        if (!validData) return cb(new ValidationError(validator.getErrors()));

        cb(null, customerId, validData);
      },
      // delete card
      (customerId, data, cb) => {
        fetchDB(cardsQuery.delete, [data.id, customerId], (err, result) => {
          if (err) return cb(err);
          if (result.rowCount === 0) return cb(new CustomError('CARD_NOT_FOUND'));

          res.status(200).json({
            success: true,
          });
          cb(null);
        });
      },
    ],
    (err) => err && next(err)
  );
}

module.exports = {
  createCard,
  getCustomerCards,
  updateCard,
  deleteCard,
};
