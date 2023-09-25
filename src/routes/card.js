var express = require('express');
const { createCard, getCustomerCards, updateCard, deleteCard } = require('../controllers/card');
const router = express.Router();

router.post('/create', createCard);
router.get('/all', getCustomerCards);
router.put('/update', updateCard);
router.delete('/delete', deleteCard);

module.exports = router;
