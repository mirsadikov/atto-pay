const async = require('async');
const verifyToken = require('../middleware/verifyToken');
const LIVR = require('../utils/livr');
const { servicesQuery } = require('../postgres/queries');
const fetchDB = require('../postgres');
const ValidationError = require('../errors/ValidationError');
const CustomError = require('../errors/CustomError');
const imageStorage = require('../utils/imageStorage');
const acceptsLanguages = require('../utils/acceptLanguages');

// @Private
// @Merchant
function createService(req, res, next) {
  let merchantId;
  let inputs;
  let newImage;
  let newService;

  async.waterfall(
    [
      // verify merchant
      (cb) => {
        verifyToken(req, 'merchant', (err, id) => {
          if (err) return cb(err);

          merchantId = id;
          cb(null);
        });
      },
      // validate data
      (cb) => {
        const { name, price, categoryCode, isActive } = req.body;

        const validator = new LIVR.Validator({
          name: ['trim', 'string', 'required', { min_length: 2 }, { max_length: 64 }],
          price: ['trim', 'integer', 'required'],
          categoryCode: ['trim', 'string', 'required'],
          isActive: ['trim', 'boolean', 'required', { default: false }],
        });

        const validData = validator.validate({
          name,
          price: Math.abs(price),
          categoryCode: categoryCode.toUpperCase(),
          isActive,
        });

        if (!validData) return cb(new ValidationError(validator.getErrors()));

        inputs = validData;
        cb(null);
      },
      // check if does not exist
      (cb) => {
        fetchDB(servicesQuery.getUnique, [merchantId, inputs.categoryCode], (err, result) => {
          if (err) return cb(err);
          if (result.rows.length > 0) return cb(new CustomError('SERVICE_ALREADY_EXISTS'));

          cb(null);
        });
      },
      // save image if attached
      (cb) => {
        if (!req.files || !req.files.image) return cb(null);

        imageStorage.upload(req.files.image, 'services', (err, newFileName) => {
          if (err) return cb(err);
          newImage = newFileName;
          cb(null);
        });
      },
      // create service
      (cb) => {
        const lang = acceptsLanguages(req);
        fetchDB(
          servicesQuery.create,
          [
            merchantId,
            inputs.categoryCode,
            inputs.name,
            inputs.price,
            newImage,
            inputs.isActive,
            lang,
          ],
          (err, result) => {
            if (err) return cb(err);

            newService = result.rows[0];
            res.status(201).json({
              success: true,
              service: {
                ...newService,
                image_url: imageStorage.getImageUrl('/service/photo', newService.image_url),
              },
            });
            cb(null);
          }
        );
      },
    ],
    (err) => {
      if (err) {
        // clear
        if (newService) fetchDB(servicesQuery.delete, [newService.id, merchantId]);
        if (newImage) imageStorage.delete(newImage, 'services');

        return next(err);
      }
    }
  );
}

// @Public
function getAllServices(req, res, next) {
  async.waterfall(
    [
      // get services
      (cb) => {
        const lang = acceptsLanguages(req);
        fetchDB(servicesQuery.getAll, [lang], (err, result) => {
          if (err) return cb(err);

          cb(null, result.rows);
        });
      },
      // get images
      (services, cb) => {
        services.forEach((service) => {
          service.image_url = imageStorage.getImageUrl('/service/photo', service.image_url);
        });

        res.status(200).json({
          count: services.length,
          services,
        });

        cb(null);
      },
    ],
    (err) => err && next(err)
  );
}

// @Public
function getServiceImage(req, res, next) {
  async.waterfall(
    [
      (cb) => {
        const { file } = req.params;

        imageStorage.getPathIfExists(file, 'services', (err, filePath) => {
          if (err) return cb(err);
          res.sendFile(filePath);
          cb(null);
        });
      },
    ],
    (err) => err && next(err)
  );
}

// @Private
// @Merchant
function updateService(req, res, next) {
  let merchantId, inputs, service;

  async.waterfall(
    [
      // verify merchant
      (cb) => {
        verifyToken(req, 'merchant', (err, id) => {
          if (err) return cb(err);

          merchantId = id;
          cb(null);
        });
      },
      // validate data
      (cb) => {
        const { id, name, price, categoryCode, isActive, deleteImage } = req.body;

        const validator = new LIVR.Validator({
          id: ['trim', 'string', 'required'],
          name: ['trim', 'string', { min_length: 2 }, { max_length: 64 }],
          price: ['trim', 'integer'],
          categoryCode: ['trim', 'string'],
          isActive: ['trim', 'boolean'],
          deleteImage: ['trim', 'boolean', { default: false }],
        });

        const validData = validator.validate({
          id,
          name,
          price: price ? Math.abs(price) : price,
          categoryCode: categoryCode ? categoryCode.toUpperCase() : categoryCode,
          isActive,
          deleteImage,
        });

        if (!validData) return cb(new ValidationError(validator.getErrors()));

        inputs = validData;
        cb(null);
      },
      // get service
      (cb) => {
        fetchDB(servicesQuery.getOneById, [inputs.id, merchantId], (err, result) => {
          if (err) return cb(err);
          if (result.rows.length === 0) return cb(new CustomError('SERVICE_NOT_FOUND'));

          service = result.rows[0];
          cb(null);
        });
      },
      // if category changed, check if does not exist
      (cb) => {
        const { categoryCode } = inputs;
        if (!categoryCode || service.category_code === categoryCode) return cb(null);

        fetchDB(servicesQuery.getUnique, [merchantId, inputs.categoryCode], (err, result) => {
          if (err) return cb(err);
          if (result.rows.length > 0) return cb(new CustomError('SERVICE_ALREADY_EXISTS'));

          cb(null);
        });
      },
      // delete old image if requested or new image attached
      (cb) => {
        if (!service.image_url) return cb(null);

        if (inputs.deleteImage || (req.files && req.files.image)) {
          imageStorage.delete(service.image_url, 'services', (err) => {
            if (!err) service.image_url = null;

            cb(null);
          });
        } else {
          cb(null);
        }
      },
      // save image if attached
      (cb) => {
        if (!req.files || !req.files.image) return cb(null, null);

        imageStorage.upload(req.files.image, 'services', (err, newFileName) => {
          if (err) return cb(err);
          cb(null, newFileName);
        });
      },
      // update service
      (newFileName, cb) => {
        const { name, price, categoryCode, isActive } = inputs;

        const newName = name || service.name;
        const newPrice = price || service.price;
        const newCategoryCode = categoryCode || service.category_code;
        const newIsActive = isActive || service.is_active;
        const newPhotoUrl = newFileName || service.image_url;
        const lang = acceptsLanguages(req);

        fetchDB(
          servicesQuery.update,
          [
            newName,
            newPrice,
            newCategoryCode,
            newIsActive,
            newPhotoUrl,
            service.id,
            merchantId,
            lang,
          ],
          (err, result) => {
            if (err) return cb(err);

            service = result.rows[0];
            res.status(200).json({
              success: true,
              service: {
                ...service,
                image_url: imageStorage.getImageUrl('/service/photo', service.image_url),
              },
            });
            cb(null);
          }
        );
      },
    ],
    (err) => err && next(err)
  );
}

// @Private
// @Merchant
function deleteService(req, res, next) {
  let merchantId;

  async.waterfall(
    [
      // verify merchant
      (cb) => {
        verifyToken(req, 'merchant', (err, id) => {
          if (err) return cb(err);

          merchantId = id;
          cb(null);
        });
      },
      // validate data
      (cb) => {
        const validator = new LIVR.Validator({
          id: ['trim', 'string', 'required'],
        });

        const validData = validator.validate({ id: req.body.id });
        if (!validData) return cb(new ValidationError(validator.getErrors()));

        cb(null, validData.id);
      },
      // delete service
      (serviceId, cb) => {
        fetchDB(servicesQuery.delete, [serviceId, merchantId], (err, result) => {
          if (err) return cb(err);
          if (result.rows.length === 0) return cb(new CustomError('SERVICE_NOT_FOUND'));

          // delete image
          if (result.rows[0].image_url) imageStorage.delete(result.rows[0].image_url, 'services');

          res.status(200).json({
            success: true,
          });

          cb(null);
        });
      },
    ],
    (err) => err && next(err)
  );
}

module.exports = {
  getAllServices,
  getServiceImage,
  createService,
  updateService,
  deleteService,
};
