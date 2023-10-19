const express = require('express');
const {
  createService,
  updateService,
  deleteService,
  getAllServices,
  getMechantServices,
  getOneById,
  getOnePublicById,
} = require('../controllers/service');
const router = express.Router();

router.get('/', getAllServices);
router.get('/merchant', getMechantServices);
router.get('/:id', getOneById);
router.post('/', createService);
router.put('/', updateService);
router.delete('/', deleteService);
router.get('/public/:id', getOnePublicById);

module.exports = router;
