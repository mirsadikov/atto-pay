const express = require('express');
const { getCategories } = require('../controllers/category');
const router = express.Router();

router.get('/', getCategories);

module.exports = router;
