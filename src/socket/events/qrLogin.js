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
    deviceId: validData.deviceId,
    exp: moment().add(2, 'minutes').toISOString(),
    socketId: socket.id,
  }; 

  const oldKey = await redis.hDel('qr_login', deviceId);
  if (oldKey) await redis.hDel('qr_login', oldKey);

  await redis.hSet('qr_login', key, JSON.stringify(body));
  socket.emit('qr_login_response', { key, timeLeft: 120 });
  redis.hSet('qr_login', deviceId, key);
}

module.exports = qrLoginRequest;
