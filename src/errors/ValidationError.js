class ValidationError extends Error {
  constructor(info) {
    super('VALIDATION_ERROR');
    this.name = 'VALIDATION_ERROR';
    this.info = info;
  }
}

module.exports = ValidationError;
