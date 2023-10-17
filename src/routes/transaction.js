const express = require('express');
const {
  payForService,
  transferMoney,
  transferMoneyToSelf,
  getTransactions,
} = require('../controllers/transaction');
const router = express.Router();

router.post('/pay', payForService);
router.post('/transfer', transferMoney);
router.post('/transfer/self', transferMoneyToSelf);
router.post('/', getTransactions);

module.exports = router;
