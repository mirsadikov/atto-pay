const express = require('express');
const {
  createService,
  updateService,
  deleteService,
  getServiceImage,
  getAllServices,
  getMechantServices,
} = require('../controllers/service');
const router = express.Router();

router.get('/', getAllServices);
router.get('/photo/:file', getServiceImage);
router.post('/', createService);
router.put('/', updateService);
router.delete('/', deleteService);
router.get('/merchant', getMechantServices);

module.exports = router;
