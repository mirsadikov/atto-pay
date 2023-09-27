var express = require('express');
const { createService,deleteService,getMerchantServices, updateService} = require('../controllers/service');
const router = express.Router();

router.post('/create',createService)
router.get('/all',getMerchantServices)
router.delete('/delete',deleteService)
router.put('/update',updateService)

module.exports=router