const customersQuery = {
  getOneById: 'select * from customer where id = $1',
  getOneByPhone: 'select * from customer where phone = $1',
  delete: 'delete from customer where id = $1 and phone = $2 returning *',
  create: `
insert into customer(name, phone, hashed_password) 
values($1, $2, $3) 
returning id, name, phone, image_url, reg_date`,
  update: `
update customer 
set name = $1, hashed_password = $2, image_url = $3 
where id = $4 
returning id, name, phone, image_url, reg_date`,
  changeStatus: `
update customer 
set is_blocked = $1, safe_login_after = $2, last_login_attempt = $3 
where id = $4`,
};

const merchantsQuery = {
  getOneById: 'select * from merchant where id = $1',
  getOneByEmail: 'select * from merchant where email = $1',
  delete: 'delete from merchant where id = $1 and email = $2 returning *',
  create: `
insert into merchant(name, email, hashed_password) 
values($1, $2, $3) 
returning id, name, email, reg_date`,
  update: `
update merchant 
set name = $1, hashed_password = $2 
where id = $3 
returning id, name, email, reg_date`,
  changeStatus: `
update merchant 
set is_blocked = $1, safe_login_after = $2, last_login_attempt = $3 
where id = $4`,
};

const cardsQuery = {
  getOneById: 'select * from customer_card where id = $1',
  getOneByPan: 'select * from customer_card where pan = $1',
  getAllByCustomerId: 'select * from customer_card where customer_id = $1',
  create: `
insert into customer_card(customer_id, name, pan, expiry_month, expiry_year) 
values($1, $2, $3, $4, $5) 
returning *`,
  update: `
update customer_card set name = $1 
where id = $2 and customer_id = $3 returning *`,
  delete: `
delete from customer_card 
where id = $1 and customer_id = $2 returning *`,
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
select *, (select code from service_category where id = s.category_id) as category_code 
from service s 
where id = $1 and merchant_id = $2`,
  getUnique: `
select * from service 
where merchant_id = $1 and category_id = (select id from service_category where code = $2)`,
  getAll: `
select s.*, c.code as category_code, c.name -> $1 as category_name 
from service s 
JOIN service_category c on s.category_id = c.id 
where is_active = true`,
  create: `
WITH inserted as (
  insert into service(merchant_id, category_id, name, price, image_url, is_active)
  values($1, (select id from service_category where code = $2), $3, $4, $5, $6)
  returning *
)
select i.*, c.code as category_code, c.name -> $7 as category_name 
from inserted i 
JOIN service_category c on i.category_id = c.id`,
  update: `
update service as s 
set name = $1, price = $2, category_id = sc.id, is_active = $4, image_url = $5 
from service_category as sc 
where s.id = $6 and s.merchant_id = $7 and sc.code = $3 
returning s.*, sc.code as category_code, sc.name -> $8 as category_name`,
  delete: 'delete from service where id = $1 and merchant_id = $2 returning *',
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
