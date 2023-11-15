const LIVR = require('livr');
const crypto = require('crypto');
const base64url = require('base64url');
const moment = require('moment');
const ValidationError = require('../../errors/ValidationError');
const redis = require('../../redis');

async function qrLoginRequest(socket) {
  const deviceId = socket.handshake.headers.deviceid;

  const validator = new LIVR.Validator({
    deviceId: ['required', 'string'],
  });

  const validData = validator.validate({ deviceId });
  if (!validData) throw new ValidationError(validator.getErrors());

  const key = base64url(crypto.randomBytes(32));
  const body = {
    key,
    expiresAt: moment().add(2, 'minutes').toISOString(),
    socketId: socket.id,
  };

  await redis.hSet('qr_login', deviceId, JSON.stringify(body));

  socket.emit('qr_login_response', { key, deviceId });
}

module.exports = qrLoginRequest;
