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

        inputs = validData;
        cb(null);
      },
      // check card is not already added
      (cb) => {
        fetchDB(cardsQuery.getOneByPan, [inputs.pan], (err, result) => {
          if (err) return cb(err);
          const card = result.rows[0];

          if (card) {
            if (card.customer_id !== customerId)
              return cb(new CustomError('CARD_BELONGS_TO_ANOTHER'));
            return cb(new CustomError('CARD_ALREADY_ADDED'));
          }

          cb(null);
        });
      },
      // create card
      (cb) => {
        fetchDB(
          cardsQuery.create,
          [customerId, inputs.name, inputs.pan, inputs.expiry_month, inputs.expiry_year],
          (err) => {
            if (err) return cb(err);

            cb(null);
          }
        );
      },
    ],
    (err) => {
      if (err) return next(err);

      res.status(201).json({
        success: true,
      });
    }
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
        fetchDB(cardsQuery.getAllByCustomer, [customerId], (err, result) => {
          if (err) return cb(err);

          cb(null, result.rowCount, result.rows);
        });
      },
    ],
    (err, count, cards) => {
      if (err) return next(err);

      res.status(200).json({ count, cards });
    }
  );
}

// @Private
// @Customer
function updateCard(req, res, next) {
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
        const { id, name } = req.body;

        const validator = new LIVR.Validator({
          id: ['trim', 'string', 'required'],
          name: ['trim', 'string', 'required', { min_length: 2 }, { max_length: 64 }],
        });

        const validData = validator.validate({ id, name });
        if (!validData) return cb(new ValidationError(validator.getErrors()));

        cb(null, validData);
      },
      // update card
      (inputs, cb) => {
        fetchDB(cardsQuery.update, [inputs.name, inputs.id, customerId], (err, result) => {
          if (err) return cb(err);
          if (result.rowCount === 0) return cb(new CustomError('CARD_NOT_FOUND'));

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
function deleteCard(req, res, next) {
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
        const { id } = req.body;

        const validator = new LIVR.Validator({
          id: ['trim', 'string', 'required'],
        });

        const validData = validator.validate({ id });
        if (!validData) return cb(new ValidationError(validator.getErrors()));

        cb(null, validData);
      },
      // delete card
      (inputs, cb) => {
        fetchDB(cardsQuery.delete, [inputs.id, customerId], (err, result) => {
          if (err) return cb(err);

          const { error_code, error_message } = result.rows[0];

          if (error_code) return cb(new CustomError(error_code, error_message));

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
function getOneById(req, res, next) {
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
        const { id } = req.params;

        const validator = new LIVR.Validator({
          id: ['trim', 'string', 'required'],
        });

        const validData = validator.validate({ id });
        if (!validData) return cb(new ValidationError(validator.getErrors()));

        cb(null, validData);
      },
      // get card
      (inputs, cb) => {
        fetchDB(cardsQuery.getOneById, [inputs.id, customerId], (err, result) => {
          if (err) return cb(err);
          if (result.rowCount === 0) return cb(new CustomError('CARD_NOT_FOUND'));

          cb(null, result.rows[0]);
        });
      },
    ],
    (err, card) => {
      if (err) return next(err);

      res.status(200).json(card);
    }
  );
}

// @Public
function getOnwerByPan(req, res, next) {
  async.waterfall(
    [
      // validate data
      (cb) => {
        const { pan } = req.body;
        const validator = new LIVR.Validator({
          pan: ['positive_integer', 'required', { length_equal: 16 }],
        });

        const validData = validator.validate({ pan });
        if (!validData) return cb(new ValidationError(validator.getErrors()));

        cb(null, validData);
      },
      // get card
      (inputs, cb) => {
        fetchDB(cardsQuery.getOwnerByPan, [inputs.pan], (err, result) => {
          if (err) return cb(err);
          if (result.rowCount === 0) return cb(new CustomError('CARD_NOT_FOUND'));

          cb(null, result.rows[0]);
        });
      },
    ],
    (err, owner) => {
      if (err) return next(err);

      res.status(200).json({ owner });
    }
  );
}

module.exports = {
  createCard,
  getCustomerCards,
  updateCard,
  deleteCard,
  getOneById,
  getOnwerByPan,
};
