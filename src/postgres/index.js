const { Pool } = require('pg');
const DatabaseError = require('../errors/DatabaseError');

const pgClient = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_SSL === 'true',
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
