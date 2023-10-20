const express = require('express');
const {
  createService,
  updateService,
  deleteService,
  getAllServices,
  getMechantServices,
  getOneById,
  getOnePublicById,
  getServiceByQr,
} = require('../controllers/service');
const router = express.Router();

router.get('/', getAllServices);
router.post('/', createService);
router.put('/', updateService);
router.delete('/', deleteService);
router.get('/merchant', getMechantServices);
router.get('/public/:id', getOnePublicById);
router.post('/qr', getServiceByQr);
router.get('/:id', getOneById);

module.exports = router;
