require('dotenv').config();
const express = require('express');
const fileUpload = require('express-fileupload');
const cors = require('cors');
const customerRouter = require('./routes/customer');
const cardRouter = require('./routes/card');
const merchantRouter = require('./routes/merchant');
const categoryRouter = require('./routes/category');
const serviceRouter = require('./routes/service');
const transactionRouter = require('./routes/transaction');
const errorHandler = require('./utils/errorHandler');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());
app.use(fileUpload());

app.use('/customer', customerRouter);
app.use('/customer/card', cardRouter);
app.use('/merchant', merchantRouter);
app.use('/category', categoryRouter);
app.use('/service', serviceRouter);
app.use('/transaction', transactionRouter);
app.use(errorHandler);

app.get('/', (_, res) => {
  res.send('Server is up!');
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
