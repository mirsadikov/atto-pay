const crypto = require('crypto');
const async = require('async');
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
          .get('/station/list')
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
          .post('/top-up/aggregator', {
            cardNumber: toCard.pan,
            extOrderNumber: id,
            amount: inputs.amount,
            amount: 76000,
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
    (err, reverse, svgateResponse, transfer_id, message) => {
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
  const { cardNumber } = req.body;

  crmClient
    .post('/card/generate_qr_code', {
      cardNumber,
    })
    .then((response) => {
      res.status(200).json({
        success: true,
        data: response.data,
      });
    })
    .catch((err) => {
      next(err);
    });
}

module.exports = {
  getStations,
  topUpCard,
  generateQrCode,
};
