const crypto = require('crypto');
const async = require('async');
const base64url = require('base64url');
const verifyToken = require('../middleware/verifyToken');
const LIVR = require('../utils/livr');
const { servicesQuery } = require('../postgres/queries');
const fetchDB = require('../postgres');
const ValidationError = require('../errors/ValidationError');
const CustomError = require('../errors/CustomError');
const fileStorageS3 = require('../utils/fileStorageS3');
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
        const { name, categoryId, fields, isActive } = req.body;

        const validator = new LIVR.Validator({
          name: ['trim', 'string', 'required', { min_length: 2 }, { max_length: 64 }],
          categoryId: ['trim', 'integer', 'required'],
          fields: [
            'required',
            {
              list_of_objects: {
                name: ['trim', 'string', 'required'],
                type: ['trim', 'string', 'required'],
                required: ['trim', 'boolean', { default: true }],
                order: ['trim', 'integer', { default: 0 }],
              },
            },
          ],
          isActive: ['trim', 'boolean', { default: false }],
        });

        const validData = validator.validate({
          name,
          categoryId: Math.abs(categoryId),
          fields: JSON.parse(fields),
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

        fileStorageS3.uploadImage(req.files.image, 'services', (err, newFileName) => {
          if (err) return cb(err);
          newImage = newFileName;
          cb(null);
        });
      },
      // create service
      (cb) => {
        // generate public key for qr code
        const publicKey = base64url(crypto.randomBytes(16));

        fetchDB(
          servicesQuery.create,
          [
            merchantId,
            inputs.categoryId,
            inputs.name,
            inputs.isActive,
            newImage,
            publicKey,
            JSON.stringify(inputs.fields),
          ],
          (err, res) => {
            if (err) return cb(err);

            const { error_code, error_message, success_message } = res.rows[0];

            if (error_code) return cb(new CustomError(error_code, error_message));

            const message = success_message[acceptsLanguages(req)];
            cb(null, message);
          }
        );
      },
    ],
    (err, message) => {
      if (err) {
        // clear
        if (newImage) fileStorageS3.delete(newImage);

        return next(err);
      }

      res.status(201).json({
        success: true,
        message,
      });
    }
  );
}

// @Public
// or
// @Private
// @Customer
function getAllServices(req, res, next) {
  let customerId,
    services = {};
  const lang = acceptsLanguages(req);

  async.waterfall(
    [
      // verify customer
      (cb) => {
        if (!req.headers.authorization) return cb(null);

        verifyToken(req, 'customer', (err, id) => {
          if (err) return cb(null);

          customerId = id;
          cb(null);
        });
      },
      // get services
      (cb) => {
        fetchDB(servicesQuery.getAll, [lang], (err, result) => {
          if (err) return cb(err);

          result.rows.forEach((service) => {
            services[service.id] = service;
          });

          cb(null);
        });
      },
      // get user saved services
      (cb) => {
        if (!customerId) return cb(null);

        fetchDB(servicesQuery.getUserSaved, [customerId], (err, result) => {
          if (err) return cb(err);

          result.rows.forEach((service) => {
            services[service.id].saved = true;
          });

          cb(null);
        });
      },
      // get images
      (cb) => {
        services = Object.values(services);
        services.forEach((service) => {
          service.image_url = fileStorageS3.getFileUrl(service.image_url);
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
function updateService(req, res, next) {
  let merchantId, inputs, service, oldImage, newImage, message;

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
        const { id, name, categoryId, isActive, deleteImage, fields } = req.body;

        const validator = new LIVR.Validator({
          id: ['trim', 'string', 'required'],
          name: ['trim', 'string', { min_length: 2 }, { max_length: 64 }],
          categoryId: ['trim', 'integer'],
          isActive: ['trim', 'boolean'],
          deleteImage: ['trim', 'boolean', { default: false }],
          fields: [
            {
              list_of_objects: {
                id: ['trim', 'string'],
                name: ['trim', 'string', 'required'],
                type: ['trim', 'string', 'required'],
                required: ['trim', 'boolean', { default: true }],
                order: ['trim', 'integer', { default: 0 }],
              },
            },
          ],
        });

        const validData = validator.validate({
          id,
          name,
          categoryId: categoryId ? Math.abs(categoryId) : categoryId,
          isActive,
          deleteImage,
          fields: JSON.parse(fields),
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

        fileStorageS3.uploadImage(req.files.image, 'services', (err, newFileName) => {
          if (err) return cb(err);

          newImage = newFileName;
          cb(null);
        });
      },
      // update service
      (cb) => {
        const { name, categoryId, isActive, fields } = inputs;

        const newName = name || service.name;
        const newCategoryId = categoryId || service.category_id;
        const newIsActive = typeof isActive === 'boolean' ? isActive : service.is_active;
        const newImageUrl = newImage || service.image_url;

        fetchDB(
          servicesQuery.update,
          [
            merchantId,
            service.id,
            newCategoryId,
            newName,
            newIsActive,
            newImageUrl,
            JSON.stringify(fields),
          ],
          (err, res) => {
            if (err) return cb(err);

            const { error_code, error_message, success_message } = res.rows[0];

            if (error_code) return cb(new CustomError(error_code, error_message));

            message = success_message[acceptsLanguages(req)];
            cb(null, newImageUrl !== oldImage);
          }
        );
      },
      // delete old image if needed
      (imageChanged, cb) => {
        if (!oldImage || !imageChanged) return cb(null);

        fileStorageS3.delete(oldImage);
        cb(null);
      },
    ],
    (err) => {
      if (err) {
        // clear
        if (newImage) fileStorageS3.delete(newImage);
        return next(err);
      }

      res.status(200).json({
        success: true,
        message,
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

          const message = result.rows[0].message[acceptsLanguages(req)];
          cb(null, message);
        });
      },
    ],
    (err, message) => {
      if (err) return next(err);

      res.status(200).json({
        success: true,
        message,
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
          service.image_url = fileStorageS3.getFileUrl(service.image_url);
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
            service.image_url = fileStorageS3.getFileUrl(service.image_url);

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

// @Public
function getOnePublicById(req, res, next) {
  let service;

  async.waterfall(
    [
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
        fetchDB(servicesQuery.getOnePublicByIdWithCategory, [inputs.id, lang], (err, result) => {
          if (err) return cb(err);
          if (result.rows.length === 0) return cb(new CustomError('SERVICE_NOT_FOUND'));

          service = result.rows[0];
          service.image_url = fileStorageS3.getFileUrl(service.image_url);

          cb(null);
        });
      },
    ],
    (err) => {
      if (err) return next(err);

      res.status(200).json(service);
    }
  );
}

// @Public
function getServiceByQr(req, res, next) {
  let service;

  async.waterfall(
    [
      // validate data
      (cb) => {
        const { key } = req.params;

        const validator = new LIVR.Validator({
          key: ['trim', 'string', 'required'],
        });

        const validData = validator.validate({ key });
        if (!validData) return cb(new ValidationError(validator.getErrors()));

        cb(null, validData);
      },
      // get service
      (inputs, cb) => {
        fetchDB(servicesQuery.getIdWithQr, [inputs.key], (err, result) => {
          if (err) return cb(err);
          if (result.rows.length === 0) return cb(new CustomError('SERVICE_NOT_FOUND'));

          service = result.rows[0];

          if (!service.is_active) return cb(new CustomError('SERVICE_NOT_ACTIVE'));

          cb(null);
        });
      },
    ],
    (err) => {
      if (err) return next(err);

      res.status(200).json({ id: service.id });
    }
  );
}

module.exports = {
  getAllServices,
  createService,
  updateService,
  deleteService,
  getMechantServices,
  getOneById,
  getOnePublicById,
  getServiceByQr,
};
