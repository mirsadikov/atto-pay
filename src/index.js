const http = require('http');
const app = require('./server');
const io = require('./socket/socket');

const server = http.createServer(app);
io.attach(server);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Example app listening on port ${PORT}`);
});
