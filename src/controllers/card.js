const async = require('async');
const moment = require('moment');
const verifyToken = require('../middleware/verifyToken');
const LIVR = require('../utils/livr');
const { cardsQuery, customersQuery, attoCardQuery } = require('../postgres/queries');
const fetchDB = require('../postgres');
const ValidationError = require('../errors/ValidationError');
const CustomError = require('../errors/CustomError');
const acceptsLanguages = require('../utils/acceptsLanguages');
const svgateRequest = require('../utils/SVGateClient');
const redisClient = require('../redis');
const crmClient = require('../utils/crmClient');

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
        const { pan, expiry_month, expiry_year, name, main } = req.body;
        const deviceId = req.headers['x-device-id'];
        let type;

        if (pan.startsWith('8600') || pan.startsWith('5614')) type = 'uzcard';
        else if (pan.startsWith('9987')) type = 'atto';
        else return cb(new CustomError('UNSUPPORTED_CARD'));

        const validator = new LIVR.Validator({
          deviceId: ['trim', 'string', 'required'],
          pan: ['required', 'valid_pan'],
          expiry_month: ['positive_integer', 'required', { min_length: 1 }, { max_length: 2 }],
          expiry_year: ['positive_integer', 'required', { min_length: 1 }, { max_length: 2 }],
          name: ['trim', 'string', 'required', { min_length: 3 }, { max_length: 64 }],
          main: ['boolean', { default: false }],
          type: ['required'],
        });

        const validData = validator.validate({
          deviceId,
          pan,
          expiry_month,
          expiry_year,
          name,
          main,
          type,
        });
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
      // save card based on type
      (cb) => {
        let cardAddFunction;
        switch (inputs.type) {
          case 'uzcard':
            cardAddFunction = saveUzcardCard;
            break;
          case 'atto':
            cardAddFunction = saveAttoCard;
            break;
          default:
            cb(new CustomError('UNSUPPORTED_CARD'));
        }

        cardAddFunction(req, customerId, inputs, (err, returnRes) => {
          if (err) return cb(err);

          cb(null, returnRes);
        });
      },
    ],
    (err, returnRes) => {
      if (err) return next(err);

      res.status(201).json(returnRes);
    }
  );
}

// @Private
// @Customer
// @Comment: To verify card with otp before adding
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
        const { name, month, year, main } = otpRequest;
        fetchDB(
          cardsQuery.save,
          [customerId, name, card.pan, month, year, card.id, main],
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
        const cardsPromises = Promise.allSettled([
          fetchDB(cardsQuery.getAllByCustomer, [customerId]),
          fetchDB(attoCardQuery.getAllByCustomer, [customerId]),
        ]);

        cardsPromises.then((results) =>
          cb(null, {
            uzcard: results[0].status === 'fulfilled' ? results[0].value.rows : [],
            atto: results[1].status === 'fulfilled' ? results[1].value.rows : [],
          })
        );
      },
      // get details
      (cards, cb) => {
        const cardDetailsPromises = Promise.all([
          cards.uzcard.length > 0 ? getUzcardCardsBalance(cards.uzcard) : [],
          cards.atto.length > 0 ? getTransportCardsBalance(cards.atto) : [],
        ]);

        cardDetailsPromises.then((results) => {
          cb(null, {
            uzcard: results[0],
            atto: results[1],
          });
        });
      },
    ],
    (err, cards) => {
      if (err) return next(err);

      res.status(200).json({
        count: Object.values(cards).flat().length,
        cards,
      });
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

// @Function
const saveUzcardCard = (_, customerId, inputs, parentCb) => {
  async.waterfall(
    [
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
              type: 'uzcard',
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
            main: inputs.main,
          }),
          (err) => {
            if (err) return cb(err);

            cb(null, info);
          }
        );
      },
    ],
    (err, info) => {
      if (err) return parentCb(err);

      parentCb(null, {
        success: true,
        info,
      });
    }
  );
};

// @Function
const saveAttoCard = (req, customerId, inputs, parentCb) => {
  async.waterfall(
    [
      // check card is not already added
      (cb) => {
        fetchDB(attoCardQuery.checkIsUnique, [inputs.pan], (err, result) => {
          if (err) return cb(err);
          const existingCard = result.rows[0];

          if (existingCard) {
            if (existingCard.customer_id !== customerId)
              return cb(new CustomError('CARD_BELONGS_TO_ANOTHER'));
            return cb(new CustomError('CARD_ALREADY_ADDED'));
          }

          cb(null);
        });
      },
      // send request to crm
      (cb) => {
        crmClient
          .get('/top-up/check', {
            params: {
              cardNumber: inputs.pan,
            },
          })
          .then(() => cb(null))
          .catch((err) => cb(err));
      },
      // save card
      (cb) => {
        fetchDB(
          attoCardQuery.save,
          [
            customerId,
            inputs.name,
            inputs.pan,
            inputs.expiry_month,
            inputs.expiry_year,
            inputs.main,
          ],
          (err, result) => {
            if (err) return cb(err);

            const message = result.rows[0].message[acceptsLanguages(req)];
            cb(null, message);
          }
        );
      },
    ],
    (err, message) => {
      if (err) return parentCb(err);

      parentCb(null, {
        success: true,
        message,
        info: {
          type: 'atto',
        },
      });
    }
  );
};

// @Function
const getTransportCardsBalance = async (cards) => {
  const transportCardsPromises = Promise.all([
    ...cards.map((card) => {
      return new Promise((resolve) => {
        crmClient
          .get('/top-up/check', {
            params: {
              cardNumber: card.pan,
            },
          })
          .then((res) =>
            resolve({
              ...card,
              balance: (res.data.data.balance / 100).toFixed(2),
              token: undefined,
            })
          )
          .catch(() => resolve({ ...card, balance: null, token: undefined }));
      });
    }),
  ]);

  const transportCards = await transportCardsPromises;
  return transportCards;
};

// @Function
const getUzcardCardsBalance = async (cards) => {
  try {
    const { result, error } = await svgateRequest('cards.get', {
      ids: cards.map((card) => card.token),
    });

    if (error) throw new Error(error);

    return cards.map((card) => {
      const details = result.find((item) => item.id === card.token);
      return details
        ? {
            ...card,
            balance: (details.balance / 100).toFixed(2),
            owner_name: details.fullName,
            token: undefined,
          }
        : { ...card, balance: null, owner_name: null };
    });
  } catch (error) {
    console.log(error);
    return cards.map((card) => ({ ...card, balance: null, owner_name: null }));
  }
};

module.exports = {
  addCard,
  verifyCard,
  getCustomerCards,
  updateCard,
  deleteCard,
  getOneById,
  getOnwerByPan,
};
