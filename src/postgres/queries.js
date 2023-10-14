const customersQuery = {
  getOneById: `
select *, (select sum(balance) from customer_card where customer_id = $1) as balance 
from customer where id = $1`,
  getOneByPhone: 'select * from customer where phone = $1',
  delete: 'delete from customer where id = $1',
  create: `
insert into customer(name, phone, hashed_password) 
values($1, $2, $3) 
returning id`,
  update: `
update customer 
set name = $1, hashed_password = $2, image_url = $3, gender = $4, birth_date = $5
where id = $6`,
  updateLang: `
update customer
set lang = $1
where id = $2`,
  addServiceToSaved: `
insert into customer_saved_service(customer_id, service_id)
values($1, $2)
on conflict do nothing`,
  removeServiceFromSaved: `
delete from customer_saved_service
where customer_id = $1 and service_id = $2`,
};

const merchantsQuery = {
  getOneById: 'select * from merchant where id = $1',
  getOneByEmail: 'select * from merchant where email = $1',
  delete: 'delete from merchant where id = $1',
  create: `
insert into merchant(name, email, hashed_password) 
values($1, $2, $3) 
returning id`,
  update: `
update merchant 
set name = $1, hashed_password = $2 
where id = $3`,
  updateLang: `
update merchant
set lang = $1
where id = $2`,
};

const cardsQuery = {
  getOneById:
    'select *, mask_credit_card(pan) as pan from customer_card where id = $1 and customer_id = $2',
  checkIsUnique: 'select customer_id from customer_card where pan = $1',
  getOwnerByPan: `
select name from customer where id = (
  select customer_id from customer_card where pan = $1
)`,
  getAllByCustomer: `
select *, mask_credit_card(pan) as pan
from customer_card where customer_id = $1`,
  create: `
insert into customer_card(customer_id, name, pan, expiry_month, expiry_year) 
values($1, $2, $3, $4, $5)`,
  update: `
update customer_card set name = $1 
where id = $2 and customer_id = $3`,
  delete: `call delete_card($1, $2, null, null)`,
};

const devicesQuery = {
  create: `
insert into customer_device(customer_id, device_id) 
values($1, $2) on conflict do nothing`,
  getOneByUid: `
select * from customer_device 
where device_id = $1 and customer_id = (select id from customer where phone = $2)`,
};

const errorsQuery = {
  get: 'select message -> $2 as message, http_code from error where name = $1',
};

const categoriesQuery = {
  getAll: 'select id, code, name -> $1 as name from service_category',
};

const servicesQuery = {
  getOneById: `
select *
from service s 
where id = $1 and merchant_id = $2 and deleted = false`,
  getOneByIdWithCategory: `
select s.*, c.code as category_code, c.name -> $3 as category_name
from service s
JOIN service_category c on s.category_id = c.id
where s.id = $1 and s.merchant_id = $2 and s.deleted = false`,
  getUnique: `
select * from service 
where merchant_id = $1 and category_id = $2 and deleted = false`,
  getAll: `
select s.id, s.merchant_id, s.category_id, s.name, s.price, s.image_url, 
  c.code as category_code, c.name -> $1 as category_name 
from service s 
JOIN service_category c on s.category_id = c.id 
where is_active = true and deleted = false`,
  create: `
insert into service(merchant_id, category_id, name, price, image_url, is_active)
select $1, $2, $3, $4, $5, $6`,
  update: `
update service
set name = $1, price = $2, category_id = $3, is_active = $4, image_url = $5 
where id = $6 and merchant_id = $7 and deleted = false`,
  delete: `
update service
set is_active = false, deleted = true
where id = $1 and merchant_id = $2 and deleted = false
returning id`,
  getAllByMerchant: `
select s.id, s.merchant_id, s.category_id, s.name, s.price, s.image_url, s.is_active,
  c.code as category_code, c.name -> $1 as category_name
from service s
JOIN service_category c on s.category_id = c.id
where merchant_id = $2 and deleted = false`,
  getUserSaved: `
select service_id as id
from customer_saved_service
where customer_id = $1`,
};

const transactionsQuery = {
  payForService: `call pay_for_service($1, $2, $3, null, null, null)`,
  transferMoney: `call transfer_money($1, $2, $3, $4, null, null, null)`,
  transferMoneyToSelf: `call transfer_money_to_self($1, $2, $3, $4, null, null, null)`,
};

module.exports = {
  customersQuery,
  cardsQuery,
  errorsQuery,
  devicesQuery,
  merchantsQuery,
  categoriesQuery,
  servicesQuery,
  transactionsQuery,
};
