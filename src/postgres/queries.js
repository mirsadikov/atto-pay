const customersQuery = {
  getOneById: 'select * from customer where id = $1',
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
};

const merchantsQuery = {
  getOneById: 'select * from merchant where id = $1',
  getOneByEmail: 'select * from merchant where email = $1',
  delete: 'delete from merchant where id = $1 and email = $2 returning *',
  create: `
insert into merchant(name, email, hashed_password) 
values($1, $2, $3) 
returning id, name, email, reg_date, lang`,
  update: `
update merchant 
set name = $1, hashed_password = $2 
where id = $3 
returning id, name, email, reg_date, lang`,
  updateLang: `
update merchant
set lang = $1
where id = $2`,
};

const cardsQuery = {
  getOneById: 'select * from customer_card where id = $1 and customer_id = $2',
  getOneByPan: 'select * from customer_card where pan = $1',
  getAllByCustomer: 'select * from customer_card where customer_id = $1',
  create: `
insert into customer_card(customer_id, name, pan, expiry_month, expiry_year) 
values($1, $2, $3, $4, $5)`,
  update: `
update customer_card set name = $1 
where id = $2 and customer_id = $3`,
  delete: `
delete from customer_card 
where id = $1 and customer_id = $2 returning id`,
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
where id = $1 and merchant_id = $2`,
  getOneByIdWithCategory: `
select s.*, c.code as category_code, c.name -> $3 as category_name
from service s
JOIN service_category c on s.category_id = c.id
where s.id = $1 and s.merchant_id = $2`,
  getUnique: `
select * from service 
where merchant_id = $1 and category_id = $2`,
  getAll: `
select s.*, c.code as category_code, c.name -> $1 as category_name 
from service s 
JOIN service_category c on s.category_id = c.id 
where is_active = true`,
  create: `
insert into service(merchant_id, category_id, name, price, image_url, is_active)
select $1, $2, $3, $4, $5, $6
returning *, 
(select code from service_category where id = $2) as category_code, 
(select name -> $7 from service_category where id = $2) as category_name
`,
  update: `
update service
set name = $1, price = $2, category_id = $3, is_active = $4, image_url = $5 
where id = $6 and merchant_id = $7
returning *, 
(select code from service_category where id = $3) as category_code, 
(select name -> $8 from service_category where id = $3) as category_name`,
  delete: 'delete from service where id = $1 and merchant_id = $2 returning *',
  getAllByMerchant: `
select s.*, c.code as category_code, c.name -> $1 as category_name
from service s
JOIN service_category c on s.category_id = c.id
where merchant_id = $2`,
};

module.exports = {
  customersQuery,
  cardsQuery,
  errorsQuery,
  devicesQuery,
  merchantsQuery,
  categoriesQuery,
  servicesQuery,
};
