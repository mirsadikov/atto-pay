const v4 = require('uuid').v4;
const { S3, PutObjectCommand } = require('@aws-sdk/client-s3');
const CustomError = require('../errors/CustomError');

class fileStorageS3 {
  constructor() {
    this.bucketName = process.env.AWS_BUCKET_NAME;
    this.s3 = new S3({
      region: process.env.AWS_BUCKET_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
      endpoint: process.env.AWS_BUCKET_ENDPOINT,
    });
  }

  uploadImage(image, subFolder, cb) {
    try {
      const ext = image.name.split('.').pop();
      const allowedExtensions = ['jpg', 'jpeg', 'png'];
      if (!allowedExtensions.includes(ext)) return cb(new CustomError('FILE_EXTENSION_ERROR'));

      const newFileName = `${v4()}.${ext}`;
      const uploadPath = subFolder ? `${subFolder}/${newFileName}` : newFileName;

      const params = {
        Bucket: this.bucketName,
        Key: uploadPath,
        Body: image.data,
        ACL: 'public-read',
      };

      this.s3.send(new PutObjectCommand(params), (err) => {
        if (err) return cb(new CustomError('FILE_UPLOAD_ERROR', err.message));

        cb(null, uploadPath);
      });
    } catch (err) {
      cb(new CustomError('FILE_READER_ERROR', err.message));
    }
  }

  delete(fileName, cb) {
    cb = cb || function () {};
    try {
      const params = {
        Bucket: this.bucketName,
        Key: fileName,
      };

      this.s3.deleteObject(params, (err, data) => {
        if (err) return cb(new CustomError('FILE_DELETE_ERROR', err.message));

        cb(null);
      });
    } catch (err) {
      cb(new CustomError('FILE_READER_ERROR', err.message));
    }
  }

  getFileUrl(fileName) {
    if (!fileName) return null;

    return `https://${this.bucketName}.${process.env.AWS_BUCKET_CDN_ENDPOINT}/${fileName}`;
  }
}

const storage = new fileStorageS3();

module.exports = storage;
