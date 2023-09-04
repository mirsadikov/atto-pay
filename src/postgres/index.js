const { Pool } = require("pg");

const pgClient = new Pool({
  host: "127.0.0.1",
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB,
  port: process.env.DB_PORT,
});

const fetchDB = (QUERY, ...params) =>
  new Promise((resolve, reject) => {
    pgClient.connect().then(() => {
      pgClient
        .query(QUERY, params.length ? params : null)
        .then(async (res) => {
          resolve(res);
        })
        .catch((err) => {
          reject(err);
        });
    });
  });

module.exports = fetchDB;
