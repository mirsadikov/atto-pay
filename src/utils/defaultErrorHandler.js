const fetchDB = require('../postgres/index');
const { errorsQuery } = require('../postgres/queries');

const defaultErrorHandler = (err, lang, cb) => {
  const isDevenv = process.env.NODE_ENV === 'development';
  const errorName = err.name || 'ERROR';

  fetchDB(errorsQuery.get, [errorName.toUpperCase(), lang], (dbError, result) => {
    if (dbError)
      return cb(500, {
        message: 'Internal Server Error',
        status: 500,
        details: isDevenv ? dbError.message : undefined,
      });

    const errorObject = result.rows[0];

    let message = 'Internal Server Error';
    let status = errorObject ? errorObject.http_code : 500;
    let info = err.info;
    let type = err.name;
    let details = isDevenv ? err.message : undefined;
    let stack = isDevenv ? err.stack : undefined;

    switch (err.name) {
      case 'VALIDATION_ERROR':
        errorObject && (message = errorObject.message.replace('{0}', err.message));
        break;
      case 'USER_BLOCKED':
      case 'TRY_AGAIN_AFTER':
        if (errorObject) {
          info = { ...info, message: errorObject.message };
          message = errorObject.message.replace('{0}', err.info.timeLeft || 120);
        }

        break;
      default:
        errorObject && (message = errorObject.message);
        break;
    }

    cb(status, {
      message,
      status,
      info,
      type,
      details,
      stack,
    });
  });
};

module.exports = defaultErrorHandler;
