var express = require('express');
const { getStations, topUpCard, generateQrCode } = require('../controllers/transport');
const router = express.Router();

router.get('/metro-stations', getStations);
router.post('/topup', topUpCard);
router.post('/qr/generate', generateQrCode);

module.exports = router;
