var express = require('express');
const {
  createCard,
  getCustomerCards,
  updateCard,
  deleteCard,
  getOneById,
  getOnwerByPan,
} = require('../controllers/card');
const router = express.Router();

router.post('/', createCard);
router.get('/', getCustomerCards);
router.put('/', updateCard);
router.delete('/', deleteCard);
router.get('/owner', getOnwerByPan);
router.get('/:id', getOneById);

module.exports = router;
