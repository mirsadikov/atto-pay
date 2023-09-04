const { Pool } = require("pg");

const pgClient = new Pool({
  host: "127.0.0.1",
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB,
  port: process.env.DB_PORT,
});

function fetchDB(QUERY, ...params) {
  pgClient.connect().then(() => {
    pgClient.query(QUERY, params).then(async (res) => {
      console.log(res.rows);
      pgClient.end();
    });
  });
  
}


module.exports = fetchDB
