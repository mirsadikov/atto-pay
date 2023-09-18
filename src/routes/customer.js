var express = require('express');
const {
  getCustomerProfile,
  customerRegister,
  customerLogin,
  updateCustomer,
  getPhoto,
  getLoginType,
  getOtpFromSMS,
} = require('../controllers/customer');
var router = express.Router();

router.get('/profile', getCustomerProfile);
router.post('/register', customerRegister);
router.post('/getlogin', getLoginType);
router.post('/login', customerLogin);
router.put('/profile', updateCustomer);
router.get('/photo/:file', getPhoto);

// FAKE OTP GETTER
router.get('/otp/recievebysms', getOtpFromSMS);

module.exports = router;
