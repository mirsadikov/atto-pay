const express = require('express')
const parserRouter = require('./routes/parser')

const app = express()
const port = 3000

app.use(express.json())

app.use('/parser', parserRouter)

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
