const defaultErrorHandler = require('../utils/defaultErrorHandler');
const acceptsLanguages = require('../utils/acceptsLanguages');

const apiErrorHandler = (err, req, res, next) => {
  const lang = acceptsLanguages(req);

  defaultErrorHandler(err, lang, (status, body) => {
    res.status(status).json(body);
  });
};

module.exports = apiErrorHandler;
