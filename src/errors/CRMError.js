class CRMError extends Error {
  constructor(message, info) {
    super(message || 'CRM_ERROR');
    this.name = 'CRM_ERROR';
    this.details = info;
  }
}

module.exports = CRMError;
