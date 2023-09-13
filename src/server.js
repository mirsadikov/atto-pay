require('dotenv').config();
const express = require('express');
const parserRouter = require('./routes/parser');
const customerRouter = require('./routes/customer');
const cardRouter = require('./routes/card');
const errorHandler = require('./utils/errorHandler');
const fileUpload = require('express-fileupload');

const app = express();
const port = 3000;

app.use(express.json());
app.use(fileUpload());

app.use('/parser', parserRouter);
app.use('/customer', customerRouter);
app.use('/customer/card', cardRouter);
app.use(errorHandler);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
