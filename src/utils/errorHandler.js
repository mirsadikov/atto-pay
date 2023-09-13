const fetchDB = require('../postgres/index');
const { errorsQuery } = require('../postgres/queries');

const errorHandler = (err, req, res, next) => {
  fetchDB(errorsQuery.get, [err.name.toUpperCase()], (dbError, result) => {
    const errorObject = result && result.rows[0];

    const lang = req.headers['accept-language'] || 'en';
    const message = errorObject
      ? errorObject.message[lang] || errorObject.message.en
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
