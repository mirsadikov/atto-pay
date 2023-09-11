require('dotenv').config();
const express = require('express');
const parserRouter = require('./routes/parser');
const customerRouter = require('./routes/customer');
const errorHandler = require('./utils/errorHandler');

const app = express();
const port = 3000;

app.use(express.json());

app.use('/parser', parserRouter);
app.use('/customer', customerRouter);
app.use(errorHandler);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
