const { Server } = require('socket.io');
const qrLoginRequest = require('./events/qrLogin');
const errorHandler = require('./errorHandler');

const io = new Server({
  cors: {
    origin: '*',
  },
})

io.on('connection', (socket) => {
  socket.on('qr_login_request', errorHandler(socket, qrLoginRequest));
});

module.exports = io;
