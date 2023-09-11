const customersQuery = {
  create: 'insert into customer(name, phone, hashed_password) values($1, $2, $3) returning *',
  getOneByPhone: 'select * from customer where phone = $1',
  getOneById: 'select * from customer where id = $1',
  getAll: 'select * from customer',
};

module.exports = { customersQuery };
