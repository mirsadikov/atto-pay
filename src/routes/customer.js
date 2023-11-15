const express = require('express');
const {
  getCustomerProfile,
  updateCustomer,
  getOtpFromSMS,
  registerCustomer,
  getCustomerLoginType,
  loginCustomer,
  updateCustomerLang,
  addServiceToSaved,
  removeServiceFromSaved,
  sendCodeToPhone,
  untrustDevice,
  getAllDevices,
  allowLoginByQR,
} = require('../controllers/customer');
const router = express.Router();

router.get('/profile', getCustomerProfile);
router.post('/register', registerCustomer);
router.post('/getlogin', getCustomerLoginType);
router.post('/sendcode', sendCodeToPhone);
router.post('/login', loginCustomer);
router.post('/login/qr', allowLoginByQR);
router.put('/profile', updateCustomer);
router.put('/lang', updateCustomerLang);
router.post('/services', addServiceToSaved);
router.delete('/services', removeServiceFromSaved);
router.delete('/device/:deviceId', untrustDevice);
router.get('/device', getAllDevices);

// FAKE OTP GETTER
router.get('/otp/recievebysms', getOtpFromSMS);

module.exports = router;
