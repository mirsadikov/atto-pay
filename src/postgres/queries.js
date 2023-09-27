const customersQuery = {
  create:
    'insert into customer(name, phone, hashed_password) values($1, $2, $3) returning id, name, phone, photo_url, reg_date',
  getOneByPhone: 'select * from customer where phone = $1',
  getOneById: 'select * from customer where id = $1',
  update:
    'update customer set name = $1, hashed_password = $2, photo_url = $3 where id = $4 returning id, name, phone, photo_url, reg_date',
  changeStatus:
    'update customer set is_blocked = $1, safe_login_after = $2, last_login_attempt = $3 where id = $4',
};

const merchantsQuery = {
  create:
    'insert into merchant(name, email, hashed_password) values($1, $2, $3) returning id, name, email, reg_date',
  getOneByEmail: 'select * from merchant where email = $1',
  getOneById: 'select * from merchant where id = $1',
  update:
    'update merchant set name = $1, hashed_password = $2 where id = $3 returning id, name, email, reg_date',
  changeStatus:
    'update merchant set is_blocked = $1, safe_login_after = $2, last_login_attempt = $3 where id = $4',
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

const devicesQuery = {
  create:
    'insert into customer_device(customer_id, device_id) values($1, $2) on conflict do nothing',
  getOneByUid:
    'select * from customer_device where device_id = $1 and customer_id = (select id from customer where phone = $2)',
};

const errorsQuery = {
  get: 'select message -> $2 as message, http_code from error where name = $1',
};
const currencyQuery={
  create: 'insert into currency( name,abbreviation) values ( $1 , $2) returning *',
  get: 'select * from currency',
  update: 'update currency set name = $1,abbreviation = $2 where id=$3 returning *',
  delete: 'delete from currency where id = $1 returning *',
  getOneById: 'select * from currency where id= $1'
};

const categoriesQuery = {
  getAll: 'select id, code, name -> $1 as name from service_category',
};
const serviceQuery ={
  add : 'insert into service(name,price,merchant_id,category_id,isActive) values ($1,$2,$3,$4,$5)returning *',
  getAll: 'select * from service',
  getOneById: 'select * from service where id=$1',
  getByMerchantIdAndCategoryId: 'select * from service where merchant_id=$1 and category_id=$2',
  getMerchantServices: 'select * from service where merchant_id=$1',
  update: 'update service set name=$1, price=$2,category_id=$3,logo_url=$4,isActive=$5 where id =$6 and merchant_id=$7 returning *',
  delete: 'delete from service where id=$1 and merchant_id=$2',
  updatePhotoUrl: 'update service set logo_url=$1 where id=$2'
}
module.exports = {
  customersQuery,
  cardsQuery,
  errorsQuery,
  devicesQuery,
  merchantsQuery,
  categoriesQuery,
  serviceQuery,
  currencyQuery
};
