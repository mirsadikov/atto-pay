const express = require('express');
const {
  createService,
  updateService,
  deleteService,
  getServiceImage,
  getAllServices,
} = require('../controllers/service');
const router = express.Router();

router.get('/', getAllServices);
router.get('/photo/:file', getServiceImage);
router.post('/', createService);
router.put('/', updateService);
router.delete('/', deleteService);

module.exports = router;
