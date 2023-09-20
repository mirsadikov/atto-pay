const fs = require('fs');
const path = require('path');
const CustomError = require('../errors/CustomError');

class imageStorage {
  constructor() {
    this.uploadPath = process.env.IMAGE_STORAGE_DIR || path.join(__dirname, '..', '..', 'uploads');

    if (!fs.existsSync(this.uploadPath)) {
      fs.mkdirSync(this.uploadPath);
    }
  }

  upload(image, fileName, cb) {
    try {
      const ext = image.name.split('.').pop();
      const allowedExtensions = ['jpg', 'jpeg', 'png'];
      if (!allowedExtensions.includes(ext)) return cb(new CustomError('FILE_EXTENSION_ERROR'));

      const newFileName = `${fileName}.${ext}`;
      const uploadPath = path.join(this.uploadPath, newFileName);

      image.mv(uploadPath, (err) => {
        if (err) return cb(new CustomError('FILE_UPLOAD_ERROR', err.message));

        cb(null, newFileName);
      });
    } catch (err) {
      cb(new CustomError('FILE_READER_ERROR', err.message));
    }
  }

  delete(fileName, cb) {
    try {
      this.getPathIfExists(fileName, (err, filePath) => {
        // skip if file already deleted
        if (err) return cb();

        fs.unlink(filePath, (err) => {
          if (err) return cb(new CustomError('FILE_DELETE_ERROR', err.message));

          cb(null);
        });
      });
    } catch (err) {
      cb(new CustomError('FILE_READER_ERROR', err.message));
    }
  }

  getPathIfExists(fileName, cb) {
    try {
      const filePath = path.join(this.uploadPath, fileName);

      // check if file exists
      fs.access(filePath, fs.constants.F_OK, (err) => {
        if (err) return cb(new CustomError('FILE_NOT_FOUND'));

        cb(null, filePath);
      });
    } catch (err) {
      cb(new CustomError('FILE_READER_ERROR', err.message));
    }
  }

  getImageUrl(fileName) {
    return fileName ? `${process.env.API_URL}/customer/photo/${fileName}` : null;
  }
}

const storage = new imageStorage();

module.exports = storage;
