const { Pool } = require('pg');
const pgClient = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB,
  port: process.env.DB_PORT,
});

const fetchDB = (QUERY, params, cb) =>
  new Promise((resolve) => {
    pgClient.connect().then((client) => {
      pgClient
        .query(QUERY, params.length ? params : null)
        .then(async (res) => {
          cb(null, res);
        })
        .catch((err) => {
          cb(err);
        })
        .finally(() => {
          client.release();
          resolve();
        });
    });
  });

module.exports = fetchDB;
