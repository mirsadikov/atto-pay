class CustomError extends Error {
  constructor(name, originalMessage, info) {
    super(originalMessage || name);
    this.info = info || undefined;
    this.name = name;
  }
}

module.exports = CustomError;
