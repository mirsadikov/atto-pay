const express = require('express');
const {
  getMerchantProfile,
  registerMerchant,
  loginMerchant,
  updateMerchant,
  updateMerchantLang,
} = require('../controllers/merchant');
const router = express.Router();

router.get('/profile', getMerchantProfile);
router.post('/register', registerMerchant);
router.post('/login', loginMerchant);
router.put('/profile', updateMerchant);
router.put('/lang', updateMerchantLang);

module.exports = router;
