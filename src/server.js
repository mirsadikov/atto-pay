const express = require('express');
const fileUpload = require('express-fileupload');
const cors = require('cors');
const customerRouter = require('./routes/customer');
const cardRouter = require('./routes/card');
const transportRouter = require('./routes/transport');
const merchantRouter = require('./routes/merchant');
const categoryRouter = require('./routes/category');
const serviceRouter = require('./routes/service');
const transactionRouter = require('./routes/transaction');
const apiErrorHandler = require('./middleware/apiErrorHandler');
const useragent = require('express-useragent');

const app = express();

app.use(cors());
app.use(express.json());
app.use(fileUpload());
app.use(useragent.express());

app.use('/customer', customerRouter);
app.use('/customer/card', cardRouter);
app.use('/merchant', merchantRouter);
app.use('/category', categoryRouter);
app.use('/service', serviceRouter);
app.use('/transaction', transactionRouter);
app.use('/transport', transportRouter);
app.use(apiErrorHandler);

app.get('/', (_, res) => {
  res.send('Server is up!');
});

module.exports = app;
