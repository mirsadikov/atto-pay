const crypto = require('crypto');
const axios = require('axios');
const { SV_GATE_URL, SV_GATE_USER, SV_GATE_PASSWORD } = require('../config/secrets');
const { default: base64url } = require('base64url');
const SVGateError = require('../errors/SVGateError');

const svgateClient = axios.create({
  baseURL: SV_GATE_URL,
  headers: {
    Authorization: `Basic ${Buffer.from(`${SV_GATE_USER}:${SV_GATE_PASSWORD}`).toString('base64')}`,
  },
});

const svgateRequest = async (method, bodyParams, cb) => {
  try {
    const id = `ATTOPAY_${base64url(crypto.randomBytes(32))}`;
    const response = await svgateClient.post(`/`, {
      jsonrpc: '2.0',
      method,
      id,
      params: bodyParams,
    });

    const { error, result, id: resId } = response.data;

    if (error) return cb(new SVGateError(error));
    if (id !== resId) return cb(new Error('SVGATE_ERROR'));

    cb(null, result);
  } catch (error) {
    cb(error);
  }
};

module.exports = svgateRequest;
