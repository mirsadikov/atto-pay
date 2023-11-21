const http = require('http');
const app = require('./server');
const io = require('./socket/socket');
const { PORT } = require('./config/secrets');

const server = http.createServer(app);
io.attach(server);

const port = PORT || 3000;
server.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
