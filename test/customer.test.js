require('dotenv').config('../.env');
const chai = require('chai');
const { expect } = require('chai');
const sinon = require('sinon');
const sinonChai = require('sinon-chai');
const customerController = require('../src/controllers/customer');
const { devicesQuery } = require('../src/postgres/queries');
const fetchDB = require('../src/postgres');
const { init: initDB, drop: dropDB } = require('../src/postgres/seeder');

chai.use(sinonChai);

before((done) => {
  initDB().then(() => done());
});
after((done) => {
  dropDB().then(() => done());
});

describe('Customer Controller', () => {
  describe('register', () => {
    let req, res, next;

    beforeEach(() => {
      req = {
        body: {
          name: 'John Doe',
          phone: '998990000000',
          password: 'qwer1234',
        },
        headers: {
          'x-device-id': 'chrome-mac',
        },
      };
      res = {
        status: sinon.stub().returnsThis(),
        json: sinon.spy(),
      };
      next = sinon.spy();
    });

    it('should register a customer', async () => {
      await customerController.registerCustomer(req, res, next);

      expect(next.notCalled).to.be.true;
      expect(res.status.calledWith(201)).to.be.true;
      expect(res.json.calledWith(sinon.match.has('token'))).to.be.true;
    });

    it('should throw validation error when invalid input', async () => {
      req.body.name = '';
      await customerController.registerCustomer(req, res, next);

      expect(next.calledWith(sinon.match.has('name', 'VALIDATION_ERROR'))).to.be.true;
    });

    it('should throw error when phone number is taken', async () => {
      await customerController.registerCustomer(req, res, next);

      expect(next.calledWith(sinon.match.has('name', 'NUMBER_TAKEN'))).to.be.true;
    });

    it('should not trust the device', async () => {
      req.body.phone = '998990000001';
      await customerController.registerCustomer(req, res, next);
      const devices = await fetchDB(devicesQuery.getOneByUid, [
        req.headers['x-device-id'],
        req.body.phone,
      ]);

      expect(devices.rows.length).to.equal(0);
    });
  });

  describe('login', () => {
    let req, res, next;

    beforeEach(() => {
      req = {
        body: {
          phone: '+998990000000',
          password: 'qwer1234',
        },
        headers: {
          'x-device-id': 'chrome-mac',
        },
      };
      res = {
        status: sinon.stub().returnsThis(),
        json: sinon.spy(),
      };
      next = sinon.spy();
    });

    it('should login a customer', async () => {
      await customerController.loginCustomer(req, res, next);

      expect(next.notCalled).to.be.true;
      expect(res.status.calledWith(200)).to.be.true;
      expect(res.json.calledWith(sinon.match.has('token'))).to.be.true;
    });

    it('should throw error when customer not found', async () => {
      req.body.phone = '+998999999999';
      await customerController.loginCustomer(req, res, next);

      expect(next.calledWith(sinon.match.has('name', 'USER_NOT_FOUND'))).to.be.true;
    });

    it('should throw error when wrong password', async () => {
      req.body.password = 'wrong-password';
      await customerController.loginCustomer(req, res, next);

      expect(res.json.notCalled).to.be.true;
      expect(next.calledWith(sinon.match.has('name', 'WRONG_PASSWORD'))).to.be.true;
    });
  });
});
