class CustomError extends Error {
  constructor(name, originalMessage) {
    super(originalMessage || name);
    this.name = name;
  }
}

module.exports = CustomError;
