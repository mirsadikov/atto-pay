const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { Pool } = require('pg');
dotenv.config();

const client = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_SSL === 'true',
});

const sqlFilePath = path.join(__dirname, 'tables.sql');

client
  .connect()
  .then(async () => {
    const sql = fs.readFileSync(sqlFilePath, 'utf8');
    return client.query(sql);
  })
  .then(() => {
    console.log('Table created successfully!');
  })
  .catch((err) => {
    console.error('Error executing SQL file:', err);
  })
  .finally(() => {
    client.end();
    process.exit(0);
  });
