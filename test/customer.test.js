require('dotenv').config('../.env');
const { expect } = require('chai');
const { registerCustomer } = require('../src/controllers/customer');

describe('Customer', () => {
  describe('registerCustomer', () => {
    it('should return a customer object', async () => {
      let sentError;
      let sentStatus;
      let sentData;

      const req = {
        body: {
          name: 'John Doe',
          phone: '+998993334456',
          password: 'qwer1234.',
        },
        headers: {
          'x-device-id': '123456789',
        },
      };

      const res = {
        status: (status) => {
          sentStatus = status;
          return res;
        },
        json: (data) => {
          sentData = data;
          return res;
        },
      };

      const next = (err) => {
        sentError = err;
      };

      registerCustomer(req, res, next).then((data) => {
        expect(data).to.be.an('object');
        expect(data).to.have.property('name');
        expect(data).to.have.property('phone');
        expect(data).to.have.property('password');
        expect(data).to.have.property('deviceId');
        expect(data).to.have.property('createdAt');
        expect(data).to.have.property('updatedAt');
        expect(data).to.have.property('id');
        expect(data).to.have.property('token');
        expect(sentError).to.be.undefined;
        expect(sentStatus).to.be.undefined;
        expect(sentData).to.be.undefined;
      });
    });
  });
});
