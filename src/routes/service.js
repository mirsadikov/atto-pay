const express = require('express');
const {
  createService,
  updateService,
  deleteService,
  getServiceImage,
  getAllServices,
  getMechantServices,
  getOneById,
} = require('../controllers/service');
const router = express.Router();

router.get('/', getAllServices);
router.get('/merchant', getMechantServices);
router.get('/:id', getOneById);
router.get('/photo/:file', getServiceImage);
router.post('/', createService);
router.put('/', updateService);
router.delete('/', deleteService);

module.exports = router;
