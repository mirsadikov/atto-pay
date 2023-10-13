const express = require('express');
const { payForService, transferMoney } = require('../controllers/transaction');
const router = express.Router();

router.post('/pay', payForService);
router.post('/transfer', transferMoney);

module.exports = router;
