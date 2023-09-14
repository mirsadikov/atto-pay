const { Pool } = require('pg');
const DatabaseError = require('../errors/DatabaseError');

const pgClient = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_SSL === 'true',
});

const fetchDB = (QUERY, params, cb) =>
  new Promise((resolve) => {
    pgClient
      .connect()
      .then((client) => {
        client
          .query(QUERY, params.length ? params : null)
          .catch((err) => {
            cb(new DatabaseError(err));
          })
          .then((res) => {
            cb(null, res);
          })
          .finally(() => {
            client.release();
            resolve();
          });
      })
      .catch((err) => {
        cb(new DatabaseError(err));
      });
  });

module.exports = fetchDB;
