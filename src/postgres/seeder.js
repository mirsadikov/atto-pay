const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { Pool } = require('pg');
dotenv.config();

const client = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_SSL === 'true',
});

async function init() {
  const sqlFilePath = path.join(__dirname, 'create.sql');
  return client
    .connect()
    .then(async () => {
      const sql = fs.readFileSync(sqlFilePath, 'utf8');
      return client.query(sql);
    })
    .then(() => {
      console.log('Tables created successfully!');
    })
    .catch((err) => {
      console.error('Error executing SQL file:', err);
    });
}

async function drop() {
  const sqlFilePath = path.join(__dirname, 'drop.sql');
  return client
    .connect()
    .then(async () => {
      const sql = fs.readFileSync(sqlFilePath, 'utf8');
      return client.query(sql);
    })
    .then(() => {
      console.log('Tables dropped successfully!');
    })
    .catch((err) => {
      console.error('Error executing SQL file:', err);
    });
}

if (process.argv[2] === '--init') init();
if (process.argv[2] === '--drop') drop();

module.exports = {
  init,
  drop,
};
