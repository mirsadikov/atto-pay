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
const { ATTO_FARE_SERVICE_ID } = require('../config/secrets');

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
            const stations = response.data;
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
              ext: `SVGATE_${base64url(crypto.randomBytes(32))}`,
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
            if (response.success) cb(null, svgateResponse, id);
            else cb(new CustomError('CRM_ERROR'), true);
          })
          .catch((err) => {
            cb(err, true, svgateResponse);
          });
      },
      // save transaction
      (svgateResponse, attoRefId, cb) => {
        fetchDB(
          transactionsQuery.createAttoTopupTransaction,
          [customerId, fromCard.id, svgateResponse.ext, toCard.id, attoRefId, inputs.amount],
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

function metroQrPay(req, res, next) {
  let customerId, inputs, fromCard;

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
        const { cardId, stationId } = req.body;

        const validator = new LIVR.Validator({
          cardId: ['trim', 'required', 'string'],
          stationId: ['positive_integer', 'required'],
        });

        const validData = validator.validate({ cardId, stationId });
        if (!validData) return cb(new ValidationError(validator.getErrors()));

        inputs = validData;
        cb(null);
      },
      // get card pan by id
      (cb) => {
        fetchDB(cardsQuery.getOneByIdWithPan, [inputs.cardId, customerId], (err, result) => {
          if (err) return cb(err);

          if (!result.rows[0]) return cb(new CustomError('CARD_NOT_FOUND'));

          fromCard = result.rows[0];
          cb(null);
        });
      },
      // pay with card
      (cb) => {
        svgateRequest(
          'trans.pay.purpose',
          {
            tran: {
              purpose: 'payment',
              cardId: fromCard.token,
              amount: 1700 * 100,
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
      (svgateResponse, cb) => {
        crmClient
          .post('/terminal/qr/aggregator/generate', {
            transactionNumber: svgateResponse.ext,
            cardNumber: fromCard.pan,
            stationId: inputs.stationId,
          })
          .then((response) => {
            const { qr, expireDate } = response.data;
            const expireDateMoment = moment(expireDate, 'YYDDDHHmm').subtract(5, 'hours'); // qr is always 5 hours ahead
            cb(null, svgateResponse, {
              qr,
              expiresIn: expireDateMoment.diff(moment(), 'seconds'),
            });
          })
          .catch((err) => {
            cb(err);
          });
      },
      // save as transaction
      (svgateResponse, response, cb) => {
        fetchDB(
          transactionsQuery.payForService,
          [
            customerId,
            fromCard.id,
            ATTO_FARE_SERVICE_ID,
            svgateResponse.amount / 100,
            svgateResponse.ext,
            JSON.stringify({}),
          ],
          (_, result) => {
            const { payment_id, success_message } = result.rows[0];

            const message = success_message ? success_message[acceptsLanguages(req)] : 'Success';
            cb(null, {
              success: true,
              message,
              payment_id,
              ...response,
            });
          }
        );
      },
    ],
    (err, response) => {
      if (err) return next(err);

      res.status(200).json(response);
    }
  );
}

function getBusInfo(req, res, next) {
  async.waterfall(
    [
      // validate data
      (cb) => {
        const { terminalId } = req.query;

        const validator = new LIVR.Validator({
          terminalId: ['trim', 'required', 'string'],
        });

        const validData = validator.validate({ terminalId });
        if (!validData) return cb(new ValidationError(validator.getErrors()));

        cb(null, validData);
      },
      // get terminal details
      (inputs, cb) => {
        crmClient
          .get('/terminal/qr/payment/info', {
            params: {
              terminalId: inputs.terminalId,
            },
          })
          .then((response) => {
            cb(null, response.data);
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

function busQrPay(req, res, next) {
  let customerId, inputs, busDetails, fromCard;

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
        const { terminalId, cardId } = req.body;

        const validator = new LIVR.Validator({
          terminalId: ['trim', 'required', 'string'],
          cardId: ['trim', 'required', 'string'],
        });

        const validData = validator.validate({ terminalId, cardId });
        if (!validData) return cb(new ValidationError(validator.getErrors()));

        inputs = validData;
        cb(null);
      },
      // get card pan by id
      (cb) => {
        fetchDB(cardsQuery.getOneByIdWithPan, [inputs.cardId, customerId], (err, result) => {
          if (err) return cb(err);

          if (!result.rows[0]) return cb(new CustomError('CARD_NOT_FOUND'));

          fromCard = result.rows[0];
          cb(null);
        });
      },
      // get bus details
      (cb) => {
        crmClient
          .get('/terminal/qr/payment/info', {
            params: {
              terminalId: inputs.terminalId,
            },
          })
          .then((response) => {
            busDetails = response.data;
            cb(null);
          })
          .catch((err) => {
            cb(err);
          });
      },
      // pay with card
      (cb) => {
        svgateRequest(
          'trans.pay.purpose',
          {
            tran: {
              purpose: 'payment',
              cardId: fromCard.token,
              amount: busDetails.fee * 100,
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
      // generate qr ticket
      (svgateResponse, cb) => {
        crmClient
          .post('/terminal/qr/payment', {
            cardNumber: svgateResponse.pan,
            expiryYear: fromCard.expiry_year,
            expiryMonth: fromCard.expiry_month,
            transNumber: svgateResponse.ext,
            terminalId: inputs.terminalId,
          })
          .then((response) => {
            cb(null, svgateResponse, response.data);
          })
          .catch((err) => {
            cb(err);
          });
      },
      // save as transaction
      (svgateResponse, ticket, cb) => {
        fetchDB(
          transactionsQuery.payForService,
          [
            customerId,
            fromCard.id,
            ATTO_FARE_SERVICE_ID,
            busDetails.fee,
            svgateResponse.ext,
            JSON.stringify({}),
          ],
          (_, result) => {
            const { payment_id, success_message } = result.rows[0];

            const message = success_message ? success_message[acceptsLanguages(req)] : 'Success';
            cb(null, {
              success: true,
              message,
              payment_id,
              details: {
                qr: ticket.qr,
                orderNumber: ticket.orderNumber,
                fee: busDetails.fee,
                bus: {
                  regNumber: busDetails.regNumber,
                  routeName: busDetails.routeName,
                },
              },
            });
          }
        );
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
  metroQrPay,
  getBusInfo,
  busQrPay,
};
