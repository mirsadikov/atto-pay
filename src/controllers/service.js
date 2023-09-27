const async = require('async')
const moment = require('moment')
const verifyToken = require('../middleware/verifyToken')
const LIVR = require('../utils/livr');
const {serviceQuery} = require('../postgres/queries');
const fetchDB = require('../postgres');
const ValidationError = require('../errors/ValidationError');
const CustomError = require('../errors/CustomError');
const {rows} = require("pg/lib/defaults");
const imageStorage = require('../utils/imageStorage')

function createService(req, res, next) {
    async.waterfall(
        [
            (cb) => {
                verifyToken(req, 'Merchant', (err, merchant_id) => {
                    if (err) {
                        return cb(err);
                    }
                    cb(null, merchant_id);
                });
            },

            (merchant_id, cb) => {
                const {name, price, category_id, isActive} = req.body;

                const validator = new LIVR.Validator({
                    name: ['trim', 'string', 'required', {min_length: 2}, {max_length: 64}],
                    price: ['positive_integer', 'required'],
                    category_id: ['positive_integer', 'required', {min_length: 1}, {max_length: 2}],
                    isActive: ['boolean', 'required', {default: false}],
                });

                const validData = validator.validate({name, price, category_id, isActive});
                if (!validData) {
                    return cb(new ValidationError(validator.getErrors()));
                }

                cb(null, merchant_id, validData);
            },

            (merchant_id, validData, cb) => {
                fetchDB(serviceQuery.getByMerchantIdAndCategoryId, [merchant_id, validData.category_id], (err, result) => {
                    if (err) {
                        return cb(err);
                    }
                    if (result.rows.length > 0) {
                        return cb(new CustomError('SERVICE_ALREADY_ADDED'));
                    }

                    cb(null, merchant_id, validData);
                });
            },

            (merchant_id, validData, cb) => {
                fetchDB(serviceQuery.add, [validData.name, validData.price, merchant_id, validData.category_id, validData.isActive], (err, result) => {
                    if (err) {
                        return cb(err);
                    }
                    const service = result.rows[0];
                    res.status(201).json(service);
                    cb(null, service);
                });
            },

            (service, cb) => {
                if (!req.files || !req.files.image) {
                    return cb(null, service);
                }

                imageStorage.upload(req.files.image, service.id, 'services', (err, newFileName) => {
                    if (err) {
                        return cb(err);
                    }
                    service.photo_url = newFileName;
                    cb(null, service);
                });
            },

            (service, cb) => {
                if (!service.photo_url) {
                    return cb(null);
                }

                fetchDB(serviceQuery.updatePhotoUrl, [service.photo_url, service.id], (err) => {
                    if (err) {
                        return cb(err);
                    }

                    cb(null);
                });
            }
        ],
        (err) => {
            if (err) {
                return next(err);
            }
        }
    );
}

function getMerchantServices(req, res, next) {
    async.waterfall(
        [
            (cb) => {
                verifyToken(req, 'Merchant', (err, merchant_id) => {
                    if (err) {
                        return cb(err);
                    }
                    cb(null, merchant_id);
                });
            },
            (merchant_id, cb) => {
                fetchDB(serviceQuery.getMerchantServices, [merchant_id], (err, result) => {
                    if (err) {
                        return cb(err);
                    }

                    res.status(200).json(result.rows);
                    cb(null);
                });
            }
        ],
        (err) => {
            if (err) {
                return next(err);
            }
        }
    );
}

function updateService(req, res, next) {
    let service;
    let inputs;
    let merchantId;
    async.waterfall(
        [
            (cb) => {
                verifyToken(req, 'Merchant', (err, merchant_id) => {
                    if (err) return cb(err);
                    merchantId = merchant_id;
                    cb(null);
                });
            },
            (cb) => {
                const {name, price, category_id, isActive, serviceId, deleteLogo} = req.body

                const validator = new LIVR.Validator(
                    {
                        name: ['trim', 'string', {min_length: 3}, {max_length: 64}],
                        price: ['integer'],
                        category_id: ['trim', 'string'],
                        isActive: ['boolean'],
                        serviceId: ['trim', 'string', 'required'],
                        deleteLogo: [{one_of: [true, false]}, {default: false}]
                    });
                const validData = validator.validate({
                    name,
                    price,
                    category_id,
                    isActive,
                    serviceId,
                    deleteLogo
                });
                if (!validData) return cb(new ValidationError(validator.getErrors()));

                inputs = validData;
                cb(null)
            },
            (cb) => {
                fetchDB(serviceQuery.getOneById, [inputs.serviceId], (err, result) => {
                    if (err) return cb(err)
                    if (result.rows.length === 0) return cb(new CustomError('SERVICE_NOT_FOUND'));
                    service = result.rows[0]
                    cb(null);
                })
            },
            (cb) => {
                if (!service.logo_url) return cb(null)

                if (inputs.deleteLogo || (req.files && req.files.avatar)) {
                    imageStorage.delete(service.logo_url, 'services', (err) => {
                        if (err) return cb(err)

                        service.logo_url = null;
                        cb(null)
                    });
                } else {
                    cb(null);
                }
            },
            (cb) => {
                if (req.files && req.files.avatar) {
                    imageStorage.upload(req.files.avatar, service.id, 'services', (err, newFileName) => {
                        if (err) return cb(err)

                        cb(null, newFileName)
                    });
                } else {
                    cb(null, service.logo_url)
                }
            },
            (newFileName,cb)=>{
            const {name,price,category_id,isActive}= inputs
                const newName=name || service.name
                const newPrice=price || service.price
                const newCategoryId =category_id || service.category_id
                const newStatus =isActive || service.isActive

                fetchDB(serviceQuery.update,[newName,newPrice,newCategoryId,newFileName,newStatus,service.id,merchantId],
                    (err,result)=>{
                    if(err) return cb(err)
                        service =result.rows[0]
                        service.logo_url=imageStorage.getImageUrl(service.logo_url)

                        res.status(200).json({
                            success: true,
                            service
                        });
                });
            },
        ],
        (err) => {
            if (err) {
                return next(err);
            }
        }
    );
}

function deleteService(req, res, next) {
    async.waterfall(
        [
            (cb) => {
                verifyToken(req, 'Merchant', (err, merchant_id) => {
                    if (err) {
                        return cb(err);
                    }
                    cb(null, merchant_id);
                });
            },

            (merchant_id, cb) => {
                const {service_id} = req.body;
                const validator = new LIVR.Validator({
                    service_id: ['trim', 'string', 'required'],
                });

                const validData = validator.validate({service_id});
                if (!validData) {
                    return cb(new ValidationError(validator.getErrors()));
                }

                cb(null, merchant_id, validData);
            },

            (merchant_id, validData, cb) => {
                fetchDB(serviceQuery.delete, [validData.service_id, merchant_id], (err, result) => {
                    if (err) {
                        return cb(err);
                    }
                    imageStorage.delete(validData.service_id + '.jpg', 'services', (err) => {
                        if (err) return cb(err);

                        cb(null)
                    })
                    res.status(200).json({
                        success: true,
                    });

                    cb(null);
                });
            },
        ],
        (err) => {
            if (err) {
                return next(err);
            }
        }
    );
}

module.exports = {createService, getMerchantServices, deleteService,updateService}