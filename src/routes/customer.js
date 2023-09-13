var express = require('express');
const {
  getCustomerProfile,
  customerRegister,
  customerLogin,
  updateCustomer,
} = require('../controllers/customer');
var router = express.Router();

router.get('/profile', getCustomerProfile);
router.post('/register', customerRegister);
router.post('/login', customerLogin);
router.put('/update', updateCustomer);

module.exports = router;
