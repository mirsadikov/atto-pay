class CRMError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CRM_ERROR';
  }
}

module.exports = CRMError;
