var express = require('express');
const { getStations } = require('../controllers/transport');
const router = express.Router();

router.get('/metro-stations', getStations);

module.exports = router;
