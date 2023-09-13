var express = require('express');
const {
  getCustomerProfile,
  customerRegister,
  customerLogin,
  updateCustomer,
  getPhoto,
} = require('../controllers/customer');
var router = express.Router();

router.get('/profile', getCustomerProfile);
router.post('/register', customerRegister);
router.post('/login', customerLogin);
router.put('/profile', updateCustomer);
router.get('/photo/:file', getPhoto);

module.exports = router;
