var express = require('express');
const { getCustomerProfile, customerRegister, customerLogin } = require('../controllers/customer');
const verifyToken = require('../middleware/verifyToken');
var router = express.Router();

router.get('/profile', verifyToken, getCustomerProfile);
router.post('/register', customerRegister);
router.post('/login', customerLogin);

module.exports = router;
