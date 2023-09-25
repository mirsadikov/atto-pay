const async = require('async');
const moment = require('moment');
const verifyToken = require('../middleware/verifyToken');
const LIVR = require('../utils/livr');
const { cardsQuery } = require('../postgres/queries');
const fetchDB = require('../postgres');
const ValidationError = require('../errors/ValidationError');
const CustomError = require('../errors/CustomError');

function createCard(req, res, next) {
  async.waterfall(
    [
      // verify user
      (cb) => {
        verifyToken(req, 'customer', (err, userId) => {
          if (err) return cb(err);
          cb(null, userId);
        });
      },
      // validate data
      (userId, cb) => {
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

        cb(null, userId, validData);
      },
      // check card is not already added
      (userId, validData, cb) => {
        fetchDB(cardsQuery.getOneByPan, [validData.pan], (err, result) => {
          if (err) return cb(err);
          if (result.rows.length > 0) return cb(new CustomError('CARD_ALREADY_ADDED'));

          cb(null, userId, validData);
        });
      },
      // create card
      (userId, validData, cb) => {
        fetchDB(
          cardsQuery.create,
          [userId, validData.name, validData.pan, validData.expiry_month, validData.expiry_year],
          (err, result) => {
            if (err) return cb(err);

            res.status(201).json(result.rows[0]);
            cb(null);
          }
        );
      },
    ],
    (err) => err && next(err)
  );
}

function getCustomerCards(req, res, next) {
  async.waterfall(
    [
      // verify user
      (cb) => {
        verifyToken(req, 'customer', (err, userId) => {
          if (err) return cb(err);
          cb(null, userId);
        });
      },
      // get cards
      (userId, cb) => {
        fetchDB(cardsQuery.getAllByCustomerId, [userId], (err, result) => {
          if (err) return cb(err);

          res.status(200).json(result.rows);
          cb(null);
        });
      },
    ],
    (err) => err && next(err)
  );
}

function updateCard(req, res, next) {
  async.waterfall(
    [
      // verify user
      (cb) => {
        verifyToken(req, 'customer', (err, userId) => {
          if (err) return cb(err);
          cb(null, userId);
        });
      },
      // validate data
      (userId, cb) => {
        const { id, name } = req.body;

        const validator = new LIVR.Validator({
          id: ['trim', 'string', 'required'],
          name: ['trim', 'string', 'required', { min_length: 2 }, { max_length: 64 }],
        });

        const validData = validator.validate({ id, name });
        if (!validData) return cb(new ValidationError(validator.getErrors()));

        cb(null, userId, validData);
      },
      // update card
      (userId, data, cb) => {
        fetchDB(cardsQuery.update, [data.name, data.id, userId], (err, result) => {
          if (err) return cb(err);
          if (result.rowCount === 0) return cb(new CustomError('CARD_NOT_FOUND'));

          res.status(200).json({
            success: true,
            details: result.rows[0],
          });
          cb(null);
        });
      },
    ],
    (err) => err && next(err)
  );
}

function deleteCard(req, res, next) {
  async.waterfall(
    [
      // verify user
      (cb) => {
        verifyToken(req, 'customer', (err, userId) => {
          if (err) return cb(err);
          cb(null, userId);
        });
      },
      // validate data
      (userId, cb) => {
        const { id } = req.body;

        const validator = new LIVR.Validator({
          id: ['trim', 'string', 'required'],
        });

        const validData = validator.validate({ id });
        if (!validData) return cb(new ValidationError(validator.getErrors()));

        cb(null, userId, validData);
      },
      // delete card
      (userId, data, cb) => {
        fetchDB(cardsQuery.delete, [data.id, userId], (err, result) => {
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
