class DatabaseError extends Error {
  constructor(error) {
    super(error.message);
    this.name = 'DATABASE_ERROR';
  }
}

module.exports = DatabaseError;
