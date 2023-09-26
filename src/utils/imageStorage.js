const fs = require('fs');
const path = require('path');
const v4 = require('uuid').v4;
const CustomError = require('../errors/CustomError');

class imageStorage {
  constructor() {
    this.uploadPath = process.env.IMAGE_STORAGE_DIR || path.join(process.cwd(), 'uploads');

    if (!fs.existsSync(this.uploadPath)) {
      fs.mkdirSync(this.uploadPath);
    }
  }

  upload(image, subFolder, cb) {
    try {
      // create subfolder if not exists
      subFolder = subFolder || '';
      const subFolderPath = path.join(this.uploadPath, subFolder);
      if (!fs.existsSync(subFolderPath)) {
        fs.mkdirSync(subFolderPath);
      }

      const ext = image.name.split('.').pop();
      const allowedExtensions = ['jpg', 'jpeg', 'png'];
      if (!allowedExtensions.includes(ext)) return cb(new CustomError('FILE_EXTENSION_ERROR'));

      const newFileName = `${v4()}.${ext}`;
      const uploadPath = path.join(this.uploadPath, subFolder, newFileName);

      image.mv(uploadPath, (err) => {
        if (err) return cb(new CustomError('FILE_UPLOAD_ERROR', err.message));

        cb(null, newFileName);
      });
    } catch (err) {
      cb(new CustomError('FILE_READER_ERROR', err.message));
    }
  }

  delete(fileName, subFolder, cb) {
    cb = cb || function () {};
    try {
      subFolder = subFolder || '';
      this.getPathIfExists(fileName, subFolder, (err, filePath) => {
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

  getPathIfExists(fileName, subFolder, cb) {
    try {
      subFolder = subFolder || '';
      const filePath = path.join(this.uploadPath, subFolder, fileName);

      // check if file exists
      fs.access(filePath, fs.constants.F_OK, (err) => {
        if (err) return cb(new CustomError('FILE_NOT_FOUND'));

        cb(null, filePath);
      });
    } catch (err) {
      cb(new CustomError('FILE_READER_ERROR', err.message));
    }
  }

  getImageUrl(path, fileName) {
    return fileName ? `${process.env.API_URL}${path}/${fileName}` : null;
  }
}

const storage = new imageStorage();

module.exports = storage;
