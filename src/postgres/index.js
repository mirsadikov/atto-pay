const { Pool } = require('pg');
const DatabaseError = require('../errors/DatabaseError');

const pgClient = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB,
  port: process.env.DB_PORT,
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
