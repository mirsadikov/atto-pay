const express = require('express');
const {
  getCustomerProfile,
  updateCustomer,
  registerCustomer,
  getCustomerLoginType,
  loginCustomer,
  updateCustomerLang,
  addServiceToSaved,
  removeServiceFromSaved,
  sendCodeToPhone,
  allowLoginByQR,
} = require('../controllers/customer');
const { getAllDevices, untrustDevice, endOtherSessions } = require('../controllers/device');
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
router.delete('/device', untrustDevice);
router.get('/device', getAllDevices);
router.post('/endsessions', endOtherSessions);

module.exports = router;
