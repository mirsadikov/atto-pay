var express = require('express');
const { getCustomerProfile, customerRegister, customerLogin } = require('../controllers/customer');
var router = express.Router();

router.get('/profile', getCustomerProfile);
router.post('/register', customerRegister);
router.post('/login', customerLogin);

module.exports = router;
