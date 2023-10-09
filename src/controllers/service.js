const async = require('async');
const verifyToken = require('../middleware/verifyToken');
const LIVR = require('../utils/livr');
const { servicesQuery } = require('../postgres/queries');
const fetchDB = require('../postgres');
const ValidationError = require('../errors/ValidationError');
const CustomError = require('../errors/CustomError');
const imageStorage = require('../utils/imageStorage');
const acceptsLanguages = require('../utils/acceptsLanguages');

// @Private
// @Merchant
function createService(req, res, next) {
  let merchantId, inputs, newImage;

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
        const { name, price, categoryId, isActive } = req.body;

        const validator = new LIVR.Validator({
          name: ['trim', 'string', 'required', { min_length: 2 }, { max_length: 64 }],
          price: ['trim', 'integer', 'required'],
          categoryId: ['trim', 'integer', 'required'],
          isActive: ['trim', 'boolean', { default: false }],
        });

        const validData = validator.validate({
          name,
          price: Math.abs(price),
          categoryId: Math.abs(categoryId),
          isActive,
        });

        if (!validData) return cb(new ValidationError(validator.getErrors()));

        inputs = validData;
        cb(null);
      },
      // check if does not exist
      (cb) => {
        fetchDB(servicesQuery.getUnique, [merchantId, inputs.categoryId], (err, result) => {
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
        fetchDB(
          servicesQuery.create,
          [merchantId, inputs.categoryId, inputs.name, inputs.price, newImage, inputs.isActive],
          (err) => {
            if (err) return cb(err);

            cb(null);
          }
        );
      },
    ],
    (err) => {
      if (err) {
        // clear
        if (newImage) imageStorage.delete(newImage);

        return next(err);
      }

      res.status(201).json({
        success: true,
      });
    }
  );
}

// @Public
function getAllServices(req, res, next) {
  let services;

  async.waterfall(
    [
      // get services
      (cb) => {
        const lang = acceptsLanguages(req);
        fetchDB(servicesQuery.getAll, [lang], (err, result) => {
          if (err) return cb(err);

          services = result.rows;
          cb(null);
        });
      },
      // get images
      (cb) => {
        services.forEach((service) => {
          service.image_url = imageStorage.getImageUrl(service.image_url);
        });

        cb(null);
      },
    ],
    (err) => {
      if (err) return next(err);

      res.status(200).json({
        count: services.length,
        services,
      });
    }
  );
}

// @Public
function getServiceImage(req, res, next) {
  try {
    const { file } = req.params;

    imageStorage.getPathIfExists(file, 'services', (err, filePath) => {
      if (err) return next(err);
      res.sendFile(filePath);
    });
  } catch (err) {
    next(err);
  }
}

// @Private
// @Merchant
function updateService(req, res, next) {
  let merchantId, inputs, service, oldImage, newImage;

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
        const { id, name, price, categoryId, isActive, deleteImage } = req.body;

        const validator = new LIVR.Validator({
          id: ['trim', 'string', 'required'],
          name: ['trim', 'string', { min_length: 2 }, { max_length: 64 }],
          price: ['trim', 'integer'],
          categoryId: ['trim', 'integer'],
          isActive: ['trim', 'boolean'],
          deleteImage: ['trim', 'boolean', { default: false }],
        });

        const validData = validator.validate({
          id,
          name,
          price: price ? Math.abs(price) : price,
          categoryId: categoryId ? Math.abs(categoryId) : categoryId,
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
        const { categoryId } = inputs;
        if (!categoryId || service.category_id === categoryId) return cb(null);

        fetchDB(servicesQuery.getUnique, [merchantId, inputs.categoryId], (err, result) => {
          if (err) return cb(err);
          if (result.rows.length > 0) return cb(new CustomError('SERVICE_ALREADY_EXISTS'));

          cb(null);
        });
      },
      // save image if attached
      (cb) => {
        oldImage = service.image_url;
        if (inputs.deleteImage) service.image_url = null;
        if (!req.files || !req.files.image) return cb(null);

        imageStorage.upload(req.files.image, 'services', (err, newFileName) => {
          if (err) return cb(err);

          newImage = newFileName;
          cb(null);
        });
      },
      // update service
      (cb) => {
        const { name, price, categoryId, isActive } = inputs;

        const newName = name || service.name;
        const newPrice = price || service.price;
        const newCategoryId = categoryId || service.category_id;
        const newIsActive = isActive === null ? service.is_active : isActive;
        const newImageUrl = newImage || service.image_url;

        fetchDB(
          servicesQuery.update,
          [newName, newPrice, newCategoryId, newIsActive, newImageUrl, service.id, merchantId],
          (err) => {
            if (err) return cb(err);

            cb(null, newImageUrl !== oldImage);
          }
        );
      },
      // delete old image if needed
      (imageChanged, cb) => {
        if (!oldImage || !imageChanged) return cb(null);

        imageStorage.delete(oldImage);
        cb(null);
      },
    ],
    (err) => {
      if (err) {
        // clear
        if (newImage) imageStorage.delete(newImage);
        return next(err);
      }

      res.status(200).json({
        success: true,
      });
    }
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

        cb(null, validData);
      },
      // delete service
      (inputs, cb) => {
        fetchDB(servicesQuery.delete, [inputs.id, merchantId], (err, result) => {
          if (err) return cb(err);
          if (result.rows.length === 0) return cb(new CustomError('SERVICE_NOT_FOUND'));

          // delete image
          if (result.rows[0].image_url) imageStorage.delete(result.rows[0].image_url);

          cb(null);
        });
      },
    ],
    (err) => {
      if (err) return next(err);

      res.status(200).json({
        success: true,
      });
    }
  );
}

// @Private
// @Merchant
function getMechantServices(req, res, next) {
  let merchantId, services;

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
      // get services
      (cb) => {
        const lang = acceptsLanguages(req);
        fetchDB(servicesQuery.getAllByMerchant, [lang, merchantId], (err, result) => {
          if (err) return cb(err);

          services = result.rows;
          cb(null);
        });
      },
      // get images
      (cb) => {
        services.forEach((service) => {
          service.image_url = imageStorage.getImageUrl(service.image_url);
        });

        cb(null);
      },
    ],
    (err) => {
      if (err) return next(err);

      res.status(200).json({
        count: services.length,
        services,
      });
    }
  );
}

// @Private
// @Merchant
function getOneById(req, res, next) {
  let merchantId, service;

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

        const validData = validator.validate({ id: req.params.id });
        if (!validData) return cb(new ValidationError(validator.getErrors()));

        cb(null, validData);
      },
      // get service
      (inputs, cb) => {
        const lang = acceptsLanguages(req);
        fetchDB(
          servicesQuery.getOneByIdWithCategory,
          [inputs.id, merchantId, lang],
          (err, result) => {
            if (err) return cb(err);
            if (result.rows.length === 0) return cb(new CustomError('SERVICE_NOT_FOUND'));

            service = result.rows[0];
            service.image_url = imageStorage.getImageUrl(service.image_url);

            cb(null);
          }
        );
      },
    ],
    (err) => {
      if (err) return next(err);

      res.status(200).json(service);
    }
  );
}

module.exports = {
  getAllServices,
  getServiceImage,
  createService,
  updateService,
  deleteService,
  getMechantServices,
  getOneById,
};
