const defaultErrorHandler = require('../utils/defaultErrorHandler');

const errorHandler = (socket, handler) => {
  const handleError = (err) => {
    const lang = socket.handshake.headers.lang || 'en';

    defaultErrorHandler(err, lang, (_, body) => {
      socket.emit('error', body);
    });
  };

  return (...args) => {
    try {
      const ret = handler.apply(this, [socket, ...args]);
      if (ret && typeof ret.catch === 'function') {
        ret.catch(handleError);
      }
    } catch (e) {
      handleError(e);
    }
  };
};

module.exports = errorHandler;
