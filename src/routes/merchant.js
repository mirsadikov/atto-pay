const express = require('express');
const {
  getMerchantProfile,
  registerMerchant,
  loginMerchant,
  updateMerchant,
} = require('../controllers/merchant');
const router = express.Router();

router.get('/profile', getMerchantProfile);
router.post('/register', registerMerchant);
router.post('/login', loginMerchant);
router.put('/profile', updateMerchant);

module.exports = router;
