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
      // create service
      (cb) => {
        fetchDB(
          servicesQuery.create,
          [merchantId, inputs.categoryCode, inputs.name, inputs.price, null, inputs.isActive],
          (err, result) => {
            if (err) return cb(err);

            newService = result.rows[0];
            cb(null);
          }
        );
      },
      // save image if attached
      (cb) => {
        if (!req.files || !req.files.image) return cb(null);

        imageStorage.upload(req.files.image, newService.id, 'services', (err, newFileName) => {
          if (err) return cb(err);
          newService.photo_url = newFileName;
          cb(null);
        });
      },
      // update image url
      (cb) => {
        if (!newService.photo_url) return cb(null);

        fetchDB(servicesQuery.updatePhoto, [newService.photo_url, newService.id], (err) => {
          if (err) return cb(err);
          cb(null);
        });
      },
      // return result
      (cb) => {
        res.status(201).json({
          success: true,
          service: {
            ...newService,
            photo_url: imageStorage.getImageUrl('/service/photo', newService.photo_url),
          },
        });
        cb(null);
      },
    ],
    (err) => {
      if (err) {
        // clear
        if (newService && newService.id)
          fetchDB(servicesQuery.delete, [newService.id, merchantId], () => {});

        if (newService && newService.photo_url)
          imageStorage.delete(newService.photo_url, 'services', () => {});

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
          service.photo_url = imageStorage.getImageUrl('/service/photo', service.photo_url);
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
  let merchantId, inputs, service, oldImage;

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
        const { id, name, price, categoryCode, isActive } = req.body;

        const validator = new LIVR.Validator({
          id: ['trim', 'string', 'required'],
          name: ['trim', 'string', { min_length: 2 }, { max_length: 64 }],
          price: ['trim', 'integer'],
          categoryCode: ['trim', 'string'],
          isActive: ['trim', 'boolean'],
        });

        const validData = validator.validate({
          id,
          name,
          price: price ? Math.abs(price) : price,
          categoryCode: categoryCode ? categoryCode.toUpperCase() : categoryCode,
          isActive,
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
      // save image if attached
      (cb) => {
        if (!req.files || !req.files.image) return cb(null);

        imageStorage.delete(service.photo_url, 'services', () => {
          imageStorage.upload(req.files.image, service.id, 'services', (err, newFileName) => {
            if (err) return cb(err);
            service.photo_url = newFileName;
            cb(null);
          });
        });
      },
      // update service
      (cb) => {
        const { name, price, categoryCode, isActive } = inputs;

        const newName = name || service.name;
        const newPrice = price || service.price;
        const newCategoryCode = categoryCode || service.category_code;
        const newIsActive = isActive || service.is_active;
        const lang = acceptsLanguages(req);

        fetchDB(
          servicesQuery.update,
          [
            newName,
            newPrice,
            newCategoryCode,
            newIsActive,
            service.photo_url,
            service.id,
            merchantId,
            lang,
          ],
          (err, result) => {
            if (err) return cb(err);

            service = result.rows[0];
            cb(null);
          }
        );
      },
      // return result
      (cb) => {
        res.status(200).json({
          success: true,
          service: {
            ...service,
            photo_url: imageStorage.getImageUrl('/service/photo', service.photo_url),
          },
        });
        cb(null);
      },
    ],
    (err) => err && next(err)
  );
}

// @Private
// @Merchant
function deleteService(req, res, next) {
  let merchantId;
  let serviceId;

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

        serviceId = validData.id;
        cb(null);
      },
      // delete service
      (cb) => {
        fetchDB(servicesQuery.delete, [serviceId, merchantId], (err, result) => {
          if (err) return cb(err);
          if (result.rows.length === 0) return cb(new CustomError('SERVICE_NOT_FOUND'));

          // delete image
          if (result.rows[0].photo_url)
            imageStorage.delete(result.rows[0].photo_url, 'services', () => {});

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
