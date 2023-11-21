const { Pool } = require('pg');
const DatabaseError = require('../errors/DatabaseError');
const { POSTGRES_URL, POSTGRES_SSL } = require('../config/secrets');

const pgClient = new Pool({
  connectionString: POSTGRES_URL,
  ssl: POSTGRES_SSL === 'true',
});

const fetchDB = (QUERY, params, cb) => {
  cb = cb || function () {};
  let client;
  return pgClient
    .connect()
    .then((c) => {
      client = c;
      return client.query(QUERY, params.length ? params : null);
    })
    .then((res) => {
      cb(null, res);
      return res;
    })
    .catch((err) => {
      console.log(err);
      cb(new DatabaseError(err));
      return err;
    })
    .finally(() => {
      client.release();
    });
};

module.exports = fetchDB;
