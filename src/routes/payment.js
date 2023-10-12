const express = require('express');
const { payForService } = require('../controllers/payment');
const router = express.Router();

router.post('/', payForService);

module.exports = router;
