var express=require('express')
const {createCurrency, getCurrency,deleteCurrency,updateCurrency}=require('../controllers/currency')
var router=express.Router();

router.post('/create',createCurrency)
router.get('/get',getCurrency)
router.delete('/delete',deleteCurrency)
router.put('/update',updateCurrency)
module.exports=router;