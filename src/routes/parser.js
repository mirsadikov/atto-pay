var express = require('express')
const { parseResponse } = require('../controllers/parser')
var router = express.Router()

router.get('/response', parseResponse)

module.exports = router
