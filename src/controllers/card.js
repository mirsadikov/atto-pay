const async = require('async');
const moment = require('moment');
const verifyToken = require('../middleware/verifyToken');
const LIVR = require('../utils/livr');
const { cardsQuery, customersQuery } = require('../postgres/queries');
const fetchDB = require('../postgres');
const ValidationError = require('../errors/ValidationError');
const CustomError = require('../errors/CustomError');
const acceptsLanguages = require('../utils/acceptsLanguages');
const svgateRequest = require('../utils/SVGateClient');
const redisClient = require('../redis');

// @Private
// @Customer
function addCard(req, res, next) {
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
        const { pan, expiry_month, expiry_year, name } = req.body;
        const deviceId = req.headers['x-device-id'];

        const validator = new LIVR.Validator({
          deviceId: ['trim', 'string', 'required'],
          pan: ['required', 'valid_pan'],
          expiry_month: ['positive_integer', 'required', { min_length: 1 }, { max_length: 2 }],
          expiry_year: ['positive_integer', 'required', { min_length: 1 }, { max_length: 2 }],
          name: ['trim', 'string', 'required', { min_length: 3 }, { max_length: 64 }],
        });

        const validData = validator.validate({ deviceId, pan, expiry_month, expiry_year, name });
        if (!validData) return cb(new ValidationError(validator.getErrors()));

        // check card expiry date is valid and not expired
        const expiryDate = moment(`${validData.expiry_month}/${validData.expiry_year}`, 'MM/YY');
        if (!expiryDate.isValid()) return cb(new CustomError('INVALID_EXPIRY_DATE'));
        if (expiryDate.isBefore(moment())) return cb(new CustomError('CARD_EXPIRED'));

        inputs = validData;
        inputs.expiry_month = inputs.expiry_month.padStart(2, '0');
        inputs.expiry_year = inputs.expiry_year.padStart(2, '0');
        cb(null);
      },
      // get customer phone
      (cb) => {
        fetchDB(customersQuery.getOneById, [customerId], (err, result) => {
          if (err) return cb(err);

          const customer = result.rows[0];
          if (!customer) return cb(new CustomError('CUSTOMER_NOT_FOUND'));

          cb(null, customer.phone);
        });
      },
      // send request to svgate
      (phone, cb) => {
        svgateRequest(
          'cards.new.otp',
          {
            card: {
              pan: inputs.pan,
              expiry: `${inputs.expiry_year}${inputs.expiry_month}`,
              requestorPhone: phone,
            },
          },
          (err, result) => {
            if (err) return cb(err);

            cb(null, result.id, {
              timeLeft: 120,
              phoneMask: result.phoneMask,
            });
          }
        );
      },
      // save request id
      (requestId, info, cb) => {
        redisClient.hSet(
          'new_card_otp',
          inputs.deviceId,
          JSON.stringify({
            requestId,
            month: inputs.expiry_month,
            year: inputs.expiry_year,
            name: inputs.name,
          }),
          (err) => {
            if (err) return cb(err);

            cb(null, info);
          }
        );
      },
    ],
    (err, info) => {
      if (err) return next(err);

      res.status(201).json({
        success: true,
        info,
      });
    }
  );
}

// @Private
// @Customer
function verifyCard(req, res, next) {
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
        const { code } = req.body;
        const deviceId = req.headers['x-device-id'];

        const validator = new LIVR.Validator({
          deviceId: ['trim', 'string', 'required'],
          code: ['trim', 'string', 'required', { min_length: 6 }, { max_length: 6 }],
        });

        const validData = validator.validate({ code, deviceId });
        if (!validData) return cb(new ValidationError(validator.getErrors()));

        inputs = validData;
        cb(null);
      },
      // get otp request id
      (cb) => {
        redisClient.hGet('new_card_otp', inputs.deviceId, (err, result) => {
          if (err) return cb(err);

          const otpRequest = JSON.parse(result);
          if (!otpRequest) return cb(new CustomError('INVALID_REQUEST'));

          cb(null, otpRequest);
        });
      },
      // verify card
      (otpRequest, cb) => {
        svgateRequest(
          'cards.new.verify',
          {
            otp: {
              id: otpRequest.requestId,
              code: inputs.code,
            },
          },
          (err, result) => {
            if (err) return cb(err);

            cb(null, otpRequest, result);
          }
        );
      },
      // check card is not already added
      (otpRequest, card, cb) => {
        fetchDB(cardsQuery.checkIsUnique, [card.pan, card.id], (err, result) => {
          if (err) return cb(err);
          const existingCard = result.rows[0];

          if (existingCard) {
            if (existingCard.customer_id !== customerId)
              return cb(new CustomError('CARD_BELONGS_TO_ANOTHER'));
            return cb(new CustomError('CARD_ALREADY_ADDED'));
          }

          cb(null, otpRequest, card);
        });
      },
      // add card
      (otpRequest, card, cb) => {
        fetchDB(
          cardsQuery.save,
          [customerId, otpRequest.name, card.pan, otpRequest.month, otpRequest.year, card.id],
          (err, result) => {
            if (err) return cb(err);

            redisClient.hDel('new_card_otp', inputs.deviceId);
            const message = result.rows[0].message[acceptsLanguages(req)];
            cb(null, message);
          }
        );
      },
    ],
    (err, message) => {
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

          cb(null, result.rows, result.rowCount);
        });
      },
      // get details
      (cards, count, cb) => {
        if (count === 0) return cb(null, count, []);

        svgateRequest(
          'cards.get',
          {
            ids: cards.map((card) => card.token),
          },
          (err, result) => {
            if (err) return cb(err);

            const cardsWithBalance = cards.map((card) => {
              const details = result.find((item) => item.id === card.token);
              return {
                ...card,
                balance: (details.balance / 100).toFixed(2),
                owner_name: details.fullName,
                token: undefined,
              };
            });

            cb(null, count, cardsWithBalance);
          }
        );
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
        const { id, name, main } = req.body;

        const validator = new LIVR.Validator({
          id: ['trim', 'string', 'required'],
          name: ['trim', 'string', 'required', { min_length: 2 }, { max_length: 64 }],
          main: ['boolean', 'required'],
        });

        const validData = validator.validate({ id, name, main });
        if (!validData) return cb(new ValidationError(validator.getErrors()));

        cb(null, validData);
      },
      // update card
      (inputs, cb) => {
        fetchDB(
          cardsQuery.update,
          [inputs.name, inputs.id, customerId, inputs.main],
          (err, result) => {
            if (err) return cb(err);
            if (result.rowCount === 0) return cb(new CustomError('CARD_NOT_FOUND'));

            const message = result.rows[0].message[acceptsLanguages(req)];
            cb(null, message);
          }
        );
      },
    ],
    (err, message) => {
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

          const { error_code, error_message, success_message } = result.rows[0];

          if (error_code) return cb(new CustomError(error_code, error_message));

          const message = success_message[acceptsLanguages(req)];
          cb(null, message);
        });
      },
    ],
    (err, message) => {
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
      // get details
      (card, cb) => {
        svgateRequest(
          'cards.get',
          {
            ids: [card.token],
          },
          (err, result) => {
            if (err) return cb(err);
            if (result.length === 0) return cb(new CustomError('CARD_NOT_FOUND'));

            const details = result[0];
            const cardWithBalance = {
              ...card,
              balance: (details.balance / 100).toFixed(2),
              owner_name: details.fullName,
              token: undefined,
            };

            cb(null, cardWithBalance);
          }
        );
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
          pan: ['required', 'valid_pan'],
        });

        const validData = validator.validate({ pan });
        if (!validData) return cb(new ValidationError(validator.getErrors()));

        cb(null, validData);
      },
      // get card details
      (inputs, cb) => {
        svgateRequest(
          'p2p.info',
          {
            hpan: inputs.pan,
          },
          (err, result) => {
            if (err) return cb(err);
            if (!result.EMBOS_NAME) return cb(new CustomError('CARD_NOT_FOUND'));

            cb(null, {
              name: result.EMBOS_NAME,
            });
          }
        );
      },
    ],
    (err, owner) => {
      if (err) return next(err);

      res.status(200).json({ owner });
    }
  );
}

module.exports = {
  addCard,
  verifyCard,
  getCustomerCards,
  updateCard,
  deleteCard,
  getOneById,
  getOnwerByPan,
};
