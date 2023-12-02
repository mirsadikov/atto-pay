var express = require('express');
const {
  getStations,
  topUpCard,
  metroQrPay,
  getBusInfo,
  busQrPay,
} = require('../controllers/transport');
const router = express.Router();

router.get('/metro-stations', getStations);
router.post('/topup', topUpCard);
router.post('/qr/metro', metroQrPay);
router.post('/qr/bus', busQrPay);
router.get('/bus', getBusInfo);

module.exports = router;
