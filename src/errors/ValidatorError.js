class ValidatorError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'ValidatorError';
    this.details = details;
  }
}

module.exports = ValidatorError;
