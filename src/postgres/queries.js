const customersQuery = {
  create: 'insert into customer(name, phone, hashed_password) values($1, $2, $3) returning *',
  getOneByPhone: 'select * from customer where phone = $1',
  getOneById: 'select * from customer where id = $1',
  getAll: 'select * from customer',
  update:
    'update customer set name = $1, hashed_password = $2, photo_url = $3 where id = $4 returning *',
};

const cardsQuery = {
  create:
    'insert into customer_card(customer_id, name, pan, expiry_month, expiry_year) values($1, $2, $3, $4, $5) returning *',
  getOneByPan: 'select * from customer_card where pan = $1',
  getOneById: 'select * from customer_card where id = $1',
  getAllByCustomerId: 'select * from customer_card where customer_id = $1',
  update: 'update customer_card set name = $1 where id = $2 and customer_id = $3 returning *',
  delete: 'delete from customer_card where id = $1 and customer_id = $2 returning *',
};

const errorsQuery = {
  get: 'select * from error where name = $1',
};

module.exports = { customersQuery, cardsQuery, errorsQuery };
