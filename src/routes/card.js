var express = require('express');
const { createCard, getCustomerCards, updateCard, deleteCard } = require('../controllers/card');
const router = express.Router();

router.post('/', createCard);
router.get('/', getCustomerCards);
router.put('/', updateCard);
router.delete('/', deleteCard);

module.exports = router;
