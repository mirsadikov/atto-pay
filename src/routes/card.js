var express = require('express');
const {
  addCard,
  getCustomerCards,
  updateCard,
  deleteCard,
  getOneById,
  getOnwerByPan,
  verifyCard,
} = require('../controllers/card');
const router = express.Router();

router.post('/', addCard);
router.post('/verify', verifyCard);
router.get('/', getCustomerCards);
router.put('/', updateCard);
router.delete('/', deleteCard);
router.post('/owner', getOnwerByPan);
router.get('/:id', getOneById);

module.exports = router;
