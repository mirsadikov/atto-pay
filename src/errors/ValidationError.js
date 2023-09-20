class ValidationError extends Error {
  constructor(info) {
    const errorString = info ? Object.keys(info).join(', ') : 'VALIDATION_ERROR';
    super(errorString);
    this.name = 'VALIDATION_ERROR';
    this.info = info;
  }
}

module.exports = ValidationError;
