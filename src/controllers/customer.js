const async = require('async');
const v4 = require('uuid').v4;
const fetchDB = require('../postgres');
const { setex, del, get } = require('../redis');
const { customersQuery } = require('../postgres/queries');

async function getCustomerProfile(req, res, next) {
  try {
    const { id } = req.user;

    const result = await fetchDB(customersQuery.getOneById, id);

    if (result.rows.length === 0) {
      res.status(404);
      throw new Error('User does not exist');
    }

    const user = result.rows[0];
    res.status(200).json(user);
  } catch (error) {
    next(error);
  }
}

function customerRegister(req, res, next) {
  try {
    const { name, phone } = req.body;

    if (!name || !phone || !name.trim() || !phone.trim()) {
      res.status(400);
      throw new Error('Name or phone is invalid');
    }

    async.waterfall(
      [
        // if user exists, return error
        (cb) => {
          fetchDB(customersQuery.getOneByPhone, phone).then((result) => {
            if (result.rows.length > 0) {
              res.status(400);
              cb(new Error('User already exists'));
            } else cb(null);
          });
        },
        // if new user, create user
        (cb) => {
          fetchDB(customersQuery.create, name, phone).then((result) => {
            res.status(201).json(result.rows[0]);
            cb(null);
          });
        },
      ],
      (err) => err && next(err)
    );
  } catch (error) {
    next(error);
  }
}

function customerLogin(req, res, next) {
  try {
    const { phone } = req.body;

    if (!phone || !phone.trim()) {
      res.status(400);
      throw new Error('Phone is invalid');
    }

    async.waterfall(
      [
        // if user not exists, return error
        (cb) => {
          fetchDB(customersQuery.getOneByPhone, phone).then((result) => {
            if (result.rows.length === 0) {
              res.status(400);
              cb(new Error('User does not exist'));
            } else cb(null, result.rows[0]);
          });
        },
        // delete old token from redis if exists
        (user, cb) => {
          get(`user_${user.id}`).then((oldToken) => {
            if (oldToken) del(`token_${oldToken}`);
            cb(null, user);
          });
        },
        // save and return new token
        (user, cb) => {
          const token = v4();
          setex(`user_${user.id}`, token, 3600);
          setex(`token_${token}`, user.id, 3600);
          res.status(200).json({ token });
          cb(null);
        },
      ],
      (err) => err && next(err)
    );
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getCustomerProfile,
  customerRegister,
  customerLogin,
};
