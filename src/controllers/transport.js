const crypto = require('crypto');
const async = require('async');
const moment = require('moment');
const verifyToken = require('../middleware/verifyToken');
const LIVR = require('../utils/livr');
const fetchDB = require('../postgres');
const ValidationError = require('../errors/ValidationError');
const CustomError = require('../errors/CustomError');
const { cardsQuery, attoCardQuery, transactionsQuery } = require('../postgres/queries');
const svgateRequest = require('../utils/SVGateClient');
const { default: base64url } = require('base64url');
const redisClient = require('../redis');
const crmClient = require('../utils/crmClient');
const acceptsLanguages = require('../utils/acceptsLanguages');

function getStations(req, res, next) {
  async.waterfall(
    [
      // get stations from redis
      (cb) => {
        redisClient.get('metro_stations', (err, stations) => {
          if (err) return cb(err);

          if (stations) {
            return cb(null, JSON.parse(stations));
          }

          cb(null, null);
        });
      },
      // get stations from crm
      (stations, cb) => {
        if (stations) {
          return cb(null, stations);
        }

        crmClient
          .get('/terminal/station/list')
          .then((response) => {
            const stations = response.data.data;
            redisClient.set('metro_stations', JSON.stringify(stations), 60 * 60);
            cb(null, stations);
          })
          .catch((err) => {
            cb(err);
          });
      },
    ],
    (err, stations) => {
      if (err) return next(err);

      res.status(200).json({
        success: true,
        lines: stations.items,
      });
    }
  );
}

function topUpCard(req, res, next) {
  let customerId, inputs, fromCard, toCard;

  async.waterfall(
    [
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

        if (fromCardId === toCardId) return cb(new CustomError('INVALID_REQUEST'));

        inputs = validData;
        cb(null);
      },
      // get card token by id
      (cb) => {
        const fetchPromises = Promise.all([
          fetchDB(attoCardQuery.getOneById, [inputs.toCardId, customerId]),
          fetchDB(cardsQuery.getOneById, [inputs.fromCardId, customerId]),
        ]);

        fetchPromises
          .then((result) => {
            if (!result[0].rows[0] || !result[1].rows[0])
              return cb(new CustomError('CARD_NOT_FOUND'));

            fromCard = result[1].rows[0];
            toCard = result[0].rows[0];
            cb(null);
          })
          .catch((err) => {
            cb(err);
          });
      },
      (cb) => {
        svgateRequest(
          'trans.pay.purpose',
          {
            tran: {
              purpose: 'payment',
              cardId: fromCard.token,
              amount: inputs.amount * 100, // convert to tiyn
              ext: `ATTOPAY_${base64url(crypto.randomBytes(32))}`,
              merchantId: '90126913',
              terminalId: '91500009',
            },
          },
          (err, result) => {
            if (err) return cb(err);

            cb(null, result);
          }
        );
      },
      // topup atto card
      (svgateResponse, cb) => {
        const id = `ATTOPAY_${base64url(crypto.randomBytes(32))}`;
        crmClient
          .post('/terminal/top-up/aggregator', {
            cardNumber: toCard.pan,
            extOrderNumber: id,
            amount: inputs.amount,
            type: 1,
            cardMask: svgateResponse.pan,
            utrnno: svgateResponse.refNum,
          })
          .then((response) => {
            if (response.data.success) cb(null, svgateResponse, id);
            else cb(new CustomError('CRM_ERROR'), true);
          })
          .catch((err) => {
            cb(err, true, svgateResponse);
          });
      },
      // save transaction
      (svgateResponse, attoRefId, cb) => {
        const { ext, pan } = svgateResponse;

        fetchDB(
          transactionsQuery.createAttoTopupTransaction,
          [customerId, fromCard.id, pan, ext, toCard.id, attoRefId, inputs.amount],
          (err, result) => {
            if (err) return cb(err, false);

            const { error_code, error_message, transfer_id, success_message } = result.rows[0];

            if (error_code) return cb(new CustomError(error_code, error_message), false);

            const message = success_message[acceptsLanguages(req)];
            cb(null, false, null, message, transfer_id);
          }
        );
      },
    ],
    (err, reverse, svgateResponse, message, transfer_id) => {
      if (err) {
        if (reverse) {
          return svgateRequest('trans.reverse', {
            tranId: svgateResponse.refNum,
          }).finally(() => {
            return next(err);
          });
        } else return next(err);
      }

      res.status(200).json({ success: true, transfer_id, message });
    }
  );
}

function generateQrCode(req, res, next) {
  let customerId, inputs;

  async.waterfall(
    [
      (cb) => {
        verifyToken(req, 'customer', (err, id) => {
          if (err) return cb(err);

          customerId = id;
          cb(null);
        });
      },
      // validate data
      (cb) => {
        const { cardId, stationId, type } = req.body;

        const validator = new LIVR.Validator({
          cardId: ['trim', 'required', 'string'],
          stationId: ['positive_integer', 'required'],
          type: ['string', 'required'],
        });

        const validData = validator.validate({ cardId, stationId, type });
        if (!validData) return cb(new ValidationError(validator.getErrors()));

        inputs = validData;
        cb(null);
      },
      // get card pan by id
      (cb) => {
        let getQuery;

        switch (inputs.type) {
          case 'atto':
            getQuery = attoCardQuery.getOneById;
            break;
          case 'uzcard':
            getQuery = cardsQuery.getOneById;
            break;
          default:
            return cb(new CustomError('INVALID_REQUEST'));
        }

        fetchDB(getQuery, [inputs.cardId, customerId], (err, result) => {
          if (err) return cb(err);

          if (!result.rows[0]) return cb(new CustomError('CARD_NOT_FOUND'));

          cb(null, result.rows[0]);
        });
      },
      // get card pan if bank card
      (card, cb) => {
        if (inputs.type === 'atto') return cb(null, card.pan);

        svgateRequest('cards.get', { ids: [card.token] }, (err, result) => {
          if (err) return cb(err);

          if (!result[0]) return cb(new CustomError('CARD_NOT_FOUND'));

          cb(null, result[0].pan);
        });
      },
      (pan, cb) => {
        const id = `ATTOPAY_${base64url(crypto.randomBytes(32))}`;
        crmClient
          .post('/terminal/qr/aggregator/generate', {
            transactionNumber: id,
            cardNumber: pan,
            stationId: inputs.stationId,
          })
          .then((response) => {
            cb(null, {
              success: true,
              qr: response.data.data.qr,
              expiresIn: moment,
            });
          })
          .catch((err) => {
            cb(err);
          });
      },
    ],
    (err, response) => {
      if (err) return next(err);

      res.status(200).json(response);
    }
  );
}

module.exports = {
  getStations,
  topUpCard,
  generateQrCode,
};
