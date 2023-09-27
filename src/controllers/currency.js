const async = require('async')
const LIVR = require('../utils/livr')
const {currencyQuery} = require('../postgres/queries');
const fetchDB = require('../postgres');
const ValidationError = require('../errors/ValidationError');
const CustomError = require('../errors/CustomError')

function createCurrency(req, res, next) {
    try {
        const {name, abbreviation} = req.body
        fetchDB(currencyQuery.create, [name, abbreviation], (err, result) => {
            if (err) return next(err)

            res.status(201).json(result.rows[0])
        })
    } catch (err) {
        next(err);
    }
}

function getCurrency(req, res, next) {
    fetchDB(currencyQuery.get, [], (err, result) => {
        try {
            if (err) return next(err)

            res.status(200).json(result.rows)
        } catch (err) {
            next(err)
        }
    })
}

async function updateCurrency(req, res, next) {
 const {name,abbreviation,id}=req.body
    let currency

    await fetchDB(currencyQuery.getOneById,[id],(err,result)=>{
        if(err) return next(err)

        if(result.rowCount===0) return next(new CustomError('Currency not found'))

        currency=result.rows[0]
    })
    const newName=name || currency.name
    const newAbbreviation=abbreviation || currency.abbreviation
    fetchDB(currencyQuery.update,[newName,newAbbreviation,id],(err,result)=>{
        if(err) return next(err)

        if(result.rowCount===0) return next(new CustomError('Currency not found'))

        res.status(200).json(result.rows[0])
    })
}

function deleteCurrency(req, res, next) {
    const {id} = req.body
    if (!id) return next(new CustomError('Currency id is missing'))

    fetchDB(currencyQuery.delete, [id], (err, result) => {
        if (err) return next(err)

        if (result.rowCount === 0) return next(new CustomError('Currency not found'))

        res.status(200).json
        (
            {success: true}
        )
    })
}

module.exports = {createCurrency, getCurrency, deleteCurrency,updateCurrency}