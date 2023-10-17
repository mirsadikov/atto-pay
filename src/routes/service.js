const express = require('express');
const {
  createService,
  updateService,
  deleteService,
  getServiceImage,
  getAllServices,
  getMechantServices,
  getOneById,
  getOnePublicById,
} = require('../controllers/service');
const router = express.Router();

router.get('/', getAllServices);
router.get('/merchant', getMechantServices);
router.get('/:id', getOneById);
router.get('/photo/:file', getServiceImage);
router.post('/', createService);
router.put('/', updateService);
router.delete('/', deleteService);
router.get('/public/:id', getOnePublicById)

module.exports = router;
