const ValidationError = require('../errors/ValidationError');
const fetchDB = require('../postgres/index');
const { errorsQuery } = require('../postgres/queries');

const errorHandler = (err, req, res, next) => {
  const lang = req.acceptsLanguages('en', 'ru', 'uz') || 'en';

  fetchDB(errorsQuery.get, [err.name.toUpperCase(), lang], (dbError, result) => {
    const errorObject = result && result.rows[0];

    const message =
      errorObject && errorObject.message
        ? err instanceof ValidationError
          ? `${errorObject.message}: ${err.message}`
          : errorObject.message
        : 'Internal Server Error';
    const status = errorObject ? errorObject.http_code : 500;
    const info = dbError ? undefined : err.info || undefined;
    const type = dbError ? undefined : err.name || undefined;
    const details =
      process.env.NODE_ENV !== 'development' ? undefined : dbError ? dbError.message : err.message;

    return res.status(status).json({
      message,
      status,
      info,
      type,
      details,
    });
  });
};

module.exports = errorHandler;
