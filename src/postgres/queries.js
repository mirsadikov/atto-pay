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
where id = $6
returning (select message from message where name = 'PROFILE_UPDATED') as message`,
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
where id = $3
returning (select message from message where name = 'PROFILE_UPDATED') as message`,
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
insert into customer_card(customer_id, name, owner_name, pan, expiry_month, expiry_year) 
values($1, $2, $3, $4, $5, $6)
returning (select message from message where name = 'CARD_ADDED') as message`,
  update: `
update customer_card set name = $1 
where id = $2 and customer_id = $3
returning (select message from message where name = 'CARD_UPDATED') as message`,
  delete: `call delete_card($1, $2, null, null, null)`,
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
  get: 'select message -> $2 as message, http_code from message where name = $1',
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
select s.id, s.merchant_id, s.category_id, s.name, s.price, s.image_url, s.is_active, s.public_key,
  c.code as category_code, c.name -> $3 as category_name
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
insert into service(merchant_id, category_id, name, price, image_url, is_active, public_key)
values ($1, $2, $3, $4, $5, $6, $7)
returning (select message from message where name = 'SERVICE_CREATED') as message`,
  update: `
update service
set name = $1, price = $2, category_id = $3, is_active = $4, image_url = $5 
where id = $6 and merchant_id = $7 and deleted = false
returning (select message from message where name = 'SERVICE_UPDATED') as message`,
  delete: `
update service
set is_active = false, deleted = true
where id = $1 and merchant_id = $2 and deleted = false
returning id, (select message from message where name = 'SERVICE_DELETED') as message`,
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
  getOnePublicByIdWithCategory: `
select s.id, s.merchant_id, s.category_id, s.name, s.price, s.image_url,
  c.code as category_code, c.name -> $2 as category_name
from service s
JOIN service_category c on s.category_id = c.id
where s.id = $1 and s.deleted = false and s.is_active = true`,
  getIdWithQr: `select id, is_active from service where public_key = $1 and deleted = false`,
};

const transactionsQuery = {
  payForService: `call pay_for_service($1, $2, $3, null, null, null, null)`,
  transferMoney: `call transfer_money($1, $2, $3, $4, null, null, null, null)`,
  transferMoneyToSelf: `call transfer_money_to_self($1, $2, $3, $4, null, null, null, null)`,
  getTransactions: `
select * 
from get_transactions($1, $2, $3, $4, $5, $6, $7)
order by created_at desc, (type = 'income') desc;`,
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
