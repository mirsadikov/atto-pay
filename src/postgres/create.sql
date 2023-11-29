create extension if not exists "uuid-ossp";

create table if not exists customer(
  id uuid primary key default uuid_generate_v4(),
  name varchar(64) not null,
  phone varchar(12) not null unique,
  image_url varchar(256),
  hashed_password text not null,
  gender varchar(1),
  birth_date date,
  lang varchar(2) not null default 'ru',
  reg_date timestamp not null default now()
);

create table if not exists bank_card(
  id uuid primary key default uuid_generate_v4(),
  customer_id uuid not null references customer(id),
  name varchar(64) not null,
  pan varchar(16) not null unique,
  expiry_month varchar(2) not null,
  expiry_year varchar(2) not null,
  token varchar(32) not null,
  main boolean not null default false,
  constraint unique_customer_pan unique(customer_id, pan)
);

create table if not exists transport_card(
  id uuid primary key default uuid_generate_v4(),
  customer_id uuid not null references customer(id),
  name varchar(64) not null,
  pan varchar(16) not null unique,
  expiry_month varchar(2) not null,
  expiry_year varchar(2) not null,
  main boolean not null default false,
  constraint unique_customer_tr_pan unique(customer_id, pan)
);

create table if not exists customer_device(
  id serial primary key,
  customer_id uuid not null references customer(id),
  device_id varchar(64) not null,
  name varchar(128) not null,
  last_login timestamp not null default now(),
  constraint unique_customer_device unique(customer_id, device_id)
);

create table if not exists message(
  id serial primary key,
  name varchar(64) not null unique,
  message jsonb not null,
  http_code int not null
);

create table if not exists merchant(
  id uuid primary key default uuid_generate_v4(),
  name varchar(30) not null,
  email varchar(64) not null unique,
  hashed_password text not null,
  lang varchar(2) not null default 'ru',
  balance numeric(12, 2) not null default (random() * 3000000),
  reg_date timestamp not null default now()
);

create table if not exists service_category(
  id serial primary key,
  code varchar(64) not null unique,
  name jsonb not null
);

create table if not exists service (
  id uuid primary key default uuid_generate_v4(),
  merchant_id uuid not null references merchant(id),
  category_id int not null references service_category(id),
  name varchar(64) not null,
  image_url varchar(256),
  is_active boolean not null default false,
  public_key varchar(64) not null unique,
  deleted boolean not null default false
);

create unique index if not exists unique_merchant_category on service(merchant_id, category_id) where deleted = false;

create table if not exists service_field (
  id uuid primary key default uuid_generate_v4(),
  service_id uuid not null references service(id),
  name varchar(64) not null,
  type varchar(16) not null,
  order_num int not null default 0,
  deleted boolean not null default false,
  constraint unique_service_field unique(service_id, name)
);

create table if not exists customer_saved_service(
  customer_id uuid not null references customer(id),
  service_id uuid not null references service(id),
  constraint unique_customer_service unique(customer_id, service_id)
);

create table if not exists payment (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid not null,
  type varchar(16) not null, 
  amount int not null,
  created_at timestamp not null default now(),
  sender_id uuid not null, 
  receiver_id uuid not null,
  ref_id varchar(64),
  fields jsonb
);

create table if not exists transfer (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid not null,
  type varchar(16) not null, 
  amount int not null,
  created_at timestamp not null default now(),
  sender_pan varchar(16),
  sender_id uuid,
  receiver_pan varchar(16),
  receiver_id uuid
);

-- ############################
-- TRIGGERS --

-- remove saved services when service is marked as deleted
create or replace function service_deleted_trigger()
returns trigger as $$
begin
  -- soft delete
  update service set deleted = true where id = old.id;
  delete from customer_saved_service where service_id = old.id;
  delete from payment where owner_id = old.merchant_id and receiver_id = old.id;
  return new;
end;
$$ language plpgsql;

create or replace trigger service_deleted_trigger
after update on service
for each row
when (old.deleted = false and new.deleted = true)
execute procedure service_deleted_trigger();

-- set card other card not main when inserted or updated card is marked as main
create or replace function set_bank_cards_not_main()
returns trigger as $$
begin
  update bank_card set main = false where customer_id = new.customer_id and id != new.id;
  return new;
end;
$$ language plpgsql;

create or replace trigger bank_card_added_trigger
after insert or update on bank_card
for each row
when (new.main = true)
execute procedure set_bank_cards_not_main();

-- ############################
-- UTILITY PROCEDURES --

-- mask credit card number
create or replace function mask_credit_card(pan varchar(16))
returns varchar(16) as $$
begin
  return concat(
    left(pan, 6),
    '******',
    right(pan, 4)
  );
end;
$$ language plpgsql;

-- MUTATION PROCEDURES --

-- creates new service with fields
create or replace procedure create_service(
  _merchant_id uuid,
  _category_id int,
  _name varchar(64),
  _is_active boolean,
  _image_url varchar(256),
  _public_key varchar(64),
  _fields jsonb,
  out error_code varchar(64),
  out error_message text,
  out success_message jsonb
) as $$
declare
  service_id uuid;
begin
  begin
    insert into service (merchant_id, category_id, name, image_url, is_active, public_key)
    values (_merchant_id, _category_id, _name, _image_url, _is_active, _public_key)
    returning id into service_id;

    begin
      for i in 0..jsonb_array_length(_fields) - 1 loop
        insert into service_field (service_id, name, type, order_num)
        values (service_id, _fields->i->>'name', _fields->i->>'type', (_fields->i->>'order')::int);
      end loop;
    exception
      when unique_violation then
        rollback;
        error_code := 'SAME_FIELD_NAME';
        return;
    end;

    select message from message where name = 'SERVICE_CREATED' into success_message;
  exception
    when others then
      rollback;
      error_code := 'DATABASE_ERROR';
      error_message := sqlerrm;
      return;
  end;

  commit;
end;
$$ language plpgsql;

-- update service with fields
create or replace procedure update_service(
  _merchant_id uuid,
  _service_id uuid,
  _category_id int,
  _name varchar(64),
  _is_active boolean,
  _image_url varchar(256),
  _fields jsonb,
  _deleted_fields jsonb,
  out error_code varchar(64),
  out error_message text,
  out success_message jsonb
) as $$
declare
  service_row service;
  i text;
begin
  begin
    select * into service_row from service where id = _service_id and merchant_id = _merchant_id and deleted = false;
  
    update service set category_id = _category_id, name = _name, image_url = _image_url, is_active = _is_active
    where id = service_row.id;

    begin
      for i in 0..jsonb_array_length(_fields) - 1 loop
        -- if there is id, update, else insert
        if (_fields->i->>'id')::uuid is not null then
          update service_field set name = _fields->i->>'name', order_num = (_fields->i->>'order')::int
          where id = (_fields->i->>'id')::uuid;
        else
          insert into service_field (service_id, name, type, order_num)
          values (service_row.id, _fields->i->>'name', _fields->i->>'type', (_fields->i->>'order')::int);
        end if;
      end loop;
    exception
      when unique_violation then
        rollback;
        error_code := 'SAME_FIELD_NAME';
        return;
    end;

    -- delete fields
    for i in 0..jsonb_array_length(_deleted_fields) - 1 loop
      -- soft delete
      update service_field set deleted = true where id = (_deleted_fields->>i)::uuid;
    end loop;

    select message from message where name = 'SERVICE_UPDATED' into success_message;
  exception
    when others then
      rollback;
      error_code := 'DATABASE_ERROR';
      error_message := sqlerrm;
      return;
  end;

  commit;
end;
$$ language plpgsql;

-- deletes related data from all tables
create or replace procedure delete_card(
  _card_id uuid,
  _customer_id uuid,
  out error_code varchar(64),
  out error_message text,
  out success_message jsonb
) as $$
begin
  begin
    delete from payment where owner_id = _customer_id and sender_id = _card_id;
    delete from transfer where owner_id = _customer_id and sender_id = _card_id;
    delete from transfer where owner_id = _customer_id and receiver_id = _card_id;
    
    delete from bank_card where id = _card_id and customer_id = _customer_id;
    if not found then 
      error_code := 'CARD_NOT_FOUND';
      return;
    end if;

    select message from message where name = 'CARD_DELETED' into success_message;
  exception
    when others then
      rollback;
      error_code := 'DATABASE_ERROR';
      error_message := sqlerrm;
      return;
  end;

  commit;
end;
$$ language plpgsql;

-- creates transactions and updates balance
create or replace procedure pay_for_service(
  _customer_id uuid,
  _card_id uuid,
  _service_id uuid,
  _amount int,
  _refId varchar(64),
  _details jsonb,
  out payment_id uuid,
  out error_code varchar(64),
  out error_message text,
  out success_message jsonb
)
as $$
declare
  service_row service;
  card_row bank_card;
  merchant_row merchant;
  service_fields jsonb := '[]';
  details jsonb := '{}';
  key_exists boolean := false;
begin
  begin
    select * into service_row from service where id = _service_id and deleted = false;
    if not found then 
      error_code := 'SERVICE_NOT_FOUND';
      return;
    end if;

    if not service_row.is_active then 
      error_code := 'SERVICE_NOT_ACTIVE';
      return;
    end if;

    select * into card_row from bank_card where id = _card_id and customer_id = _customer_id;
    if not found then 
      error_code := 'CARD_NOT_FOUND';
      return;
    end if;

    if card_row.balance < _amount then 
      error_code := 'INSUFFICIENT_FUNDS';
      return;
    end if;
    
    -- save service_field names
    select jsonb_agg(jsonb_build_object('id', id, 'name', name)) into service_fields from service_field where service_id = _service_id and deleted = false;

    -- loop service_fields and check if all required fields are provided, then add them to details
    if jsonb_array_length(service_fields) > 0 then
      for i in 0..jsonb_array_length(service_fields) - 1 loop
        -- key_exists variable
        select exists(select 1 from jsonb_each(_details) where key = service_fields->i->>'id') into key_exists;

        if not key_exists then
          error_code := 'VALIDATION_ERROR';
          error_message := service_fields;
          return;
        end if;

        -- add service_fields to details
        if key_exists then
          details := details || jsonb_build_object(service_fields->i->>'id', _details->(service_fields->i->>'id'));
        end if;
      end loop;
    end if;

    insert into payment (owner_id, type, amount, sender_id, receiver_id, fields, ref_id)
    values (_customer_id, 'expense', _amount, card_row.id, _service_id, details, _refId)
    returning id into payment_id;

    insert into payment (owner_id, type, amount, sender_id, receiver_id, fields)
    values (service_row.merchant_id, 'income', _amount, _customer_id, _service_id, details);

    update merchant set balance = balance + _amount where id = service_row.merchant_id;

    select message from message where name = 'PAYMENT_SUCCESS' into success_message;
  exception
    when others then
      rollback;
      error_code := 'TRANSACTION_ERROR';
      error_message := sqlerrm;
      return;
  end;

  commit;
end;
$$ language plpgsql;

-- creates transactions and updates balance
create or replace procedure transfer_money(
  _customer_id uuid,
  _from_card_id uuid,
  _to_pan varchar(16),
  _amount int,
  out transfer_id uuid,
  out error_code varchar(64),
  out error_message text,
  out success_message jsonb
) as $$
declare
  sender_card bank_card;
  receiver_card bank_card;
begin
  begin
    select * into sender_card from bank_card where id = _from_card_id and customer_id = _customer_id;
    if not found then 
      error_code := 'CARD_NOT_FOUND';
      return;
    end if;

    select * into receiver_card from bank_card where pan = _to_pan;
    if not found then 
      error_code := 'CARD_NOT_FOUND';
      return;
    end if;

    if sender_card.id = receiver_card.id then 
      error_code := 'SAME_CARD';
      return;
    end if;

    if sender_card.balance < _amount then 
      error_code := 'INSUFFICIENT_FUNDS';
      return;
    end if;

    insert into transfer (owner_id, type, amount, sender_id, receiver_pan, receiver_id)
    values (_customer_id, 'expense', _amount, _from_card_id, receiver_card.pan, receiver_card.customer_id)
    returning id into transfer_id;

    insert into transfer (owner_id, type, amount, sender_pan, sender_id, receiver_id)
    values (receiver_card.customer_id, 'income', _amount, sender_card.pan, sender_card.customer_id, receiver_card.id);

    update bank_card set balance = balance - _amount where id = sender_card.id;
    update bank_card set balance = balance + _amount where id = receiver_card.id;

    select message from message where name = 'TRANSFER_SUCCESS' into success_message;
  exception
    when others then
      rollback;
      error_code := 'TRANSACTION_ERROR';
      error_message := sqlerrm;
      return;
  end;

  commit;
end;
$$ language plpgsql;

-- creates transactions and updates balance
create or replace procedure transfer_money_to_self(
  _customer_id uuid,
  _from_card_id uuid,
  _to_card_id uuid,
  _amount int,
  out transfer_id uuid,
  out error_code varchar(64),
  out error_message text,
  out success_message jsonb
) as $$
declare
  sender_card bank_card;
  receiver_card bank_card;
begin
  begin
    select * into sender_card from bank_card where id = _from_card_id and customer_id = _customer_id;
    if not found then 
      error_code := 'CARD_NOT_FOUND';
      return;
    end if;

    select * into receiver_card from bank_card where id = _to_card_id and customer_id = _customer_id;
    if not found then 
      error_code := 'CARD_NOT_FOUND';
      return;
    end if;

    if sender_card.balance < _amount then 
      error_code := 'INSUFFICIENT_FUNDS';
      return;
    end if;

    insert into transfer (owner_id, type, amount, sender_id, receiver_pan, receiver_id)
    values (_customer_id, 'expense', _amount, _from_card_id, receiver_card.pan, receiver_card.customer_id)
    returning id into transfer_id;

    insert into transfer (owner_id, type, amount, sender_pan, sender_id, receiver_id)
    values (_customer_id, 'income', _amount, sender_card.pan, sender_card.customer_id, _to_card_id);

    update bank_card set balance = balance - _amount where id = sender_card.id;
    update bank_card set balance = balance + _amount where id = receiver_card.id;

    select message from message where name = 'TRANSFER_SUCCESS' into success_message;
  exception
    when others then
      rollback;
      error_code := 'TRANSACTION_ERROR';
      error_message := sqlerrm;
      return;
  end;

  commit;
end;
$$ language plpgsql;


-- ############################
-- FUNCTIONS --

-- returns all transactions of a customer within a given time range
create or replace function get_transactions(
  _customer_id uuid,
  _from timestamp,
  _to timestamp,
  _page int default 1,
  _limit int default 20,
  _card_id uuid default null,
  _service_id uuid default null
)
returns table (
  total_count int,
  id uuid,
  owner_id uuid,
  type varchar(16),
  action text,
  amount int,
  created_at timestamp,
  sender jsonb, 
  receiver jsonb
) as $$
declare
  total_count int := 0;
begin
  drop table if exists alltransactions;

  create temp table alltransactions AS (
    -- expense transfer
    select t.id, t.owner_id, t.type, 'transfer' as action, t.amount, t.created_at,
    jsonb_build_object('id', own_card.id, 'name', own_card.name, 'pan', mask_credit_card(own_card.pan)) as sender, 
    jsonb_build_object('name', receiver_customer.name, 'image_url', receiver_customer.image_url, 'pan', mask_credit_card(t.receiver_pan)) as receiver
    from transfer t
    join bank_card own_card on own_card.id = t.sender_id
    join customer receiver_customer on receiver_customer.id = t.receiver_id
    where t.owner_id = _customer_id and t.created_at between _from and _to
    union all
    -- expense payment
    select p.id, p.owner_id, p.type, 'payment' as action, p.amount, p.created_at,
    jsonb_build_object('id', own_card.id, 'name', own_card.name, 'pan', mask_credit_card(own_card.pan)) as sender,
    jsonb_build_object('id', s.id, 'name', s.name, 'image_url', s.image_url) as receiver
    from payment p
    join bank_card own_card on own_card.id = p.sender_id
    join service s on s.id = p.receiver_id
    where p.owner_id = _customer_id and p.created_at between _from and _to
    union all
    -- income transfer
    select t.id, t.owner_id, t.type, 'transfer' as action, t.amount, t.created_at,
    jsonb_build_object('name', sender_customer.name, 'image_url', sender_customer.image_url, 'pan', mask_credit_card(t.sender_pan)) as sender,
    jsonb_build_object('id', own_card.id, 'name', own_card.name, 'pan', mask_credit_card(own_card.pan)) as receiver
    from transfer t
    join customer sender_customer on sender_customer.id = t.sender_id
    join bank_card own_card on own_card.id = t.receiver_id
    where t.owner_id = _customer_id and t.created_at between _from and _to
  );

  select count(*) into total_count from alltransactions
  where (_card_id is null or (alltransactions.sender->>'id')::uuid = _card_id or (alltransactions.receiver->>'id')::uuid = _card_id)
  and (_service_id is null or (alltransactions.receiver->>'id')::uuid = _service_id);

  return query
  select total_count, alltransactions.*
  from alltransactions 
  order by alltransactions.created_at desc, (alltransactions.type = 'income') desc
  limit _limit offset (_page - 1) * _limit;
end;
$$ language plpgsql;


-- get one transaction with details
create or replace function get_transaction_by_id(
  _customer_id uuid,
  _transaction_id uuid,
  _type varchar(16) -- payment or transfer
)
returns table (
  id uuid,
  owner_id uuid,
  type varchar(16),
  action text,
  amount int,
  created_at timestamp,
  sender jsonb, 
  receiver jsonb,
  fields jsonb
) as $$
begin
  if _type = 'payment' then
    return query
      select p.id, p.owner_id, p.type, 'payment' as action, p.amount, p.created_at,
      jsonb_build_object('id', own_card.id, 'name', own_card.name, 'pan', mask_credit_card(own_card.pan)) as sender,
      jsonb_build_object('id', s.id, 'name', s.name, 'image_url', s.image_url) as receiver,
      (
        SELECT
        jsonb_agg(
          jsonb_build_object(
            'id', field_key::uuid,
            'name', sf.name, 
            'type', sf.type,
            'value', p.fields->>field_key
          )
        )
      FROM
        jsonb_object_keys(p.fields) AS field_key
      JOIN
        service_field sf ON sf.id = field_key::uuid
      ) as fields
      from payment p
      join bank_card own_card on own_card.id = p.sender_id
      join service s on s.id = p.receiver_id
      where p.owner_id = _customer_id and p.id = _transaction_id;
  else
    return query
      select t.id, t.owner_id, t.type, 'transfer' as action, t.amount, t.created_at,
      jsonb_build_object('name', sender_customer.name, 'image_url', sender_customer.image_url, 'pan', mask_credit_card(t.sender_pan)) as sender,
      jsonb_build_object('id', own_card.id, 'name', own_card.name, 'pan', mask_credit_card(own_card.pan)) as receiver,
      'null'::jsonb as fields
      from transfer t
      join customer sender_customer on sender_customer.id = t.sender_id
      join bank_card own_card on own_card.id = t.receiver_id
      where t.owner_id = _customer_id and t.id = _transaction_id
      union all
      select t.id, t.owner_id, t.type, 'transfer' as action, t.amount, t.created_at,
      jsonb_build_object('id', own_card.id, 'name', own_card.name, 'pan', mask_credit_card(own_card.pan)) as sender,
      jsonb_build_object('name', receiver_customer.name, 'image_url', receiver_customer.image_url, 'pan', mask_credit_card(t.receiver_pan)) as receiver,
      'null'::jsonb as fields
      from transfer t
      join bank_card own_card on own_card.id = t.sender_id
      join customer receiver_customer on receiver_customer.id = t.receiver_id
      where t.owner_id = _customer_id and t.id = _transaction_id;
  end if;
end;
$$ language plpgsql;


-- ############################
-- DATA INSERTION --
insert into message(name, message, http_code) values
('VALIDATION_ERROR', '{"en": "Invalid input for {0}", "uz": "{0} uchun notog''ri kiritish", "ru": "Неверный ввод для {0}"}', 400),
('DATABASE_ERROR', '{"en": "Database error", "uz": "Ma''lumotlar bazasi xatosi", "ru": "Ошибка базы данных"}', 500),
('NUMBER_TAKEN', '{"en": "This phone number is already registered", "uz": "Bu telefon raqami allaqachon ro''yhatdan o''tgan", "ru": "Этот номер телефона уже зарегистрирован"}', 409),
('USER_NOT_FOUND', '{"en": "User not found", "uz": "Foydalanuvchi topilmadi", "ru": "Пользователь не найден"}', 404),
('WRONG_PASSWORD', '{"en": "Wrong password", "uz": "Noto''g''ri parol", "ru": "Неверный пароль"}', 401),
('MISSING_TOKEN', '{"en": "Missing token", "uz": "Token topilmadi", "ru": "Отсутствует токен"}', 401),
('INVALID_TOKEN', '{"en": "Invalid token", "uz": "Noto''g''ri token", "ru": "Неверный токен"}', 401),
('EXPIRED_TOKEN', '{"en": "Expired token", "uz": "Muddati o''tgan token", "ru": "Истекший токен"}', 401),
('NOT_ALLOWED', '{"en": "Not allowed", "uz": "Ruxsat etilmagan", "ru": "Не разрешено"}', 401),
('INVALID_EXPIRY_DATE', '{"en": "Invalid expiration date", "uz": "Amal qilish muddati noto''g''ri", "ru": "Неверный срок действия"}', 400),
('CARD_EXPIRED', '{"en": "Card expired", "uz": "Karta muddati tugagan", "ru": "Срок действия карты истек"}', 400),
('CARD_ALREADY_ADDED', '{"en": "Card already added", "uz": "Karta allaqachon qo''shilgan", "ru": "Карта уже добавлена"}', 409),
('CARD_BELONGS_TO_ANOTHER', '{"en": "Card belongs to another user", "uz": "Karta boshqa foydalanuvchiga tegishli", "ru": "Карта принадлежит другому пользователю"}', 403),
('CARD_NOT_FOUND', '{"en": "Card not found", "uz": "Karta topilmadi", "ru": "Карта не найдена"}', 404),
('ERROR', '{"en": "Internal server error", "uz": "Server xatosi", "ru": "Ошибка сервера"}', 500),
('FILE_EXTENSION_ERROR', '{"en": "This type of file is not allowed", "uz": "Bu turga ega fayllar ruxsat etilmagan", "ru": "Этот тип файла не разрешен"}', 400),
('FILE_UPLOAD_ERROR', '{"en": "Error while uploading file", "uz": "Fayl yuklashda xatolik", "ru": "Ошибка при загрузке файла"}', 500),
('FILE_NOT_ATTACHED', '{"en": "File is not provided", "uz": "Fayl berilmagan", "ru": "Файл не предоставлен"}', 400),
('FILE_DELETE_ERROR', '{"en": "Error while deleting file", "uz": "Fayl o''chirishda xatolik", "ru": "Ошибка при удалении файла"}', 500),
('FILE_NOT_FOUND', '{"en": "File not found", "uz": "Fayl topilmadi", "ru": "Файл не найден"}', 404),
('FILE_READER_ERROR', '{"en": "Error while reading file", "uz": "Faylni o''qishda xatolik", "ru": "Ошибка при чтении файла"}', 500),
('USER_BLOCKED', '{"en": "User is blocked, try again after {0} seconds", "uz": "Foydalanuvchi bloklangan, {0} sekunddan keyin urinib ko''ring", "ru": "Пользователь заблокирован, попробуйте снова через {0} секунд"}', 403),
('WRONG_OTP', '{"en": "Wrong verification code", "uz": "Tekshirish kodi noto''g''ri", "ru": "Неверный код подтверждения"}', 400),
('EXPIRED_OTP', '{"en": "Verification code is expired", "uz": "Tasdiqlash kodi eskirgan", "ru": "Код подтверждения истек"}', 400),
('EMAIL_TAKEN', '{"en": "This email address is already registered", "uz": "Bu elektron pochta allaqachon ro''yxatdan o''tgan", "ru": "Этот адрес электронной почты уже зарегистрирован"}', 400),
('SERVICE_ALREADY_EXISTS', '{"en": "Adding multiple services in one category is not allowed", "uz": "Bitta kategoriyada bir nechta xizmat qo''shib bo''lmaydi", "ru": "Нельзя добавить несколько услуг в одну категорию"}', 409),
('SERVICE_NOT_FOUND', '{"en": "Service not found", "uz": "Xizmat topilmadi", "ru": "Услуга не найдена"}', 404),
('INSUFFICIENT_FUNDS', '{"en": "Insufficient funds", "uz": "Mablag'' yetarli emas", "ru": "Недостаточно средств"}', 400),
('TRANSACTION_ERROR', '{"en": "Transaction error", "uz": "Tranzaksiyada xatolik", "ru": "Ошибка транзакции"}', 500),
('SAME_CARD', '{"en": "You cannot transfer money to the same card", "uz": "Bitta kartaga pul o''tkazib bo''lmaydi", "ru": "Нельзя перевести деньги на ту же карту"}', 400),
('SERVICE_NOT_ACTIVE', '{"en": "Service not available", "uz": "Xizmat mavjud emas", "ru": "Услуга недоступна"}', 400),
('PROFILE_UPDATED', '{"en": "Profile updated successfully", "uz": "Profil muvaffaqiyatli yangilandi", "ru": "Профиль успешно обновлен"}', 200),
('CARD_ADDED', '{"en": "Card added successfully", "uz": "Karta muvaffaqiyatli qo''shildi", "ru": "Карта успешно добавлена"}', 200),
('CARD_UPDATED', '{"en": "Card updated successfully", "uz": "Karta muvaffaqiyatli yangilandi", "ru": "Карта успешно обновлена"}', 200),
('CARD_DELETED', '{"en": "Card deleted successfully", "uz": "Karta muvaffaqiyatli o''chirildi", "ru": "Карта успешно удалена"}', 200),
('SERVICE_CREATED', '{"en": "Service created successfully", "uz": "Xizmat muvaffaqiyatli yaratildi", "ru": "Услуга успешно создана"}', 200),
('SERVICE_UPDATED', '{"en": "Service updated successfully", "uz": "Xizmat muvaffaqiyatli yangilandi", "ru": "Услуга успешно обновлена"}', 200),
('SERVICE_DELETED', '{"en": "Service deleted successfully", "uz": "Xizmat muvaffaqiyatli o''chirildi", "ru": "Услуга успешно удалена"}', 200),
('PAYMENT_SUCCESS', '{"en": "Payment successful", "uz": "To''lov muvaffaqiyatli amalga oshirildi", "ru": "Оплата прошла успешно"}', 200),
('TRANSFER_SUCCESS', '{"en": "Money transferred successfully", "uz": "Pul muvaffaqiyatli o''tkazildi", "ru": "Деньги успешно переведены"}', 200),
('SAME_FIELD_NAME', '{"en": "Field name cannot be same", "uz": "Maydon nomi bir xil bo''lishi mumkin emas", "ru": "Название поля не может быть одинаковым"}', 409),
('TOO_MANY_TRIES', '{"en": "Too many tries", "uz": "Juda ko''p urinishlar", "ru": "Слишком много попыток"}', 403),
('TRY_AGAIN_AFTER', '{"en": "Try again after {0} seconds", "uz": "{0} sekunddan keyin urinib ko''ring", "ru": "Попробуйте снова через {0} секунд"}', 403),
('INVALID_REQUEST', '{"en": "Invalid request", "uz": "Noto''g''ri so''rov", "ru": "Неверный запрос"}', 400),
('EXPIRED_QR_LOGIN', '{"en": "QR login expired", "uz": "QR login muddati tugagan", "ru": "QR логин истек"}', 400),
('TRANSACTION_NOT_FOUND', '{"en": "Transaction not found", "uz": "Tranzaksiya topilmadi", "ru": "Транзакция не найдена"}', 404),
('ALLOWED_FOR_TRUSTED', '{"en": "This action is allowed only for trusted devices", "uz": "Ushbu amal faqat ishonchli qurilmalar uchun ruxsat etilgan", "ru": "Это действие разрешено только для доверенных устройств"}', 403),
('UNTRUST_SUCCESS', '{"en": "Removed from trusted devices", "uz": "Ishonchli qurilmalardan olib tashlandi", "ru": "Удалено из доверенных устройств"}', 200),
('SESSIONS_ENDED', '{"en": "Terminated all other sessions", "uz": "Boshqa sessiyalarni tugatildi", "ru": "Завершены все другие сессии"}', 200),
('QR_LOGIN_SUCCESS', '{"en": "QR login successful", "uz": "QR login muvaffaqiyatli amalga oshirildi", "ru": "QR логин прошел успешно"}', 200),
('SVGATE_ERROR', '{"en": "Payment gateway error", "uz": "To''lov tizimi xatosi", "ru": "Ошибка платежного шлюза"}', 500),
('CARD_BLOCKED', '{"en": "Card is blocked", "uz": "Karta bloklangan", "ru": "Карта заблокирована"}', 403),
('CRM_ERROR', '{"en": "External service error", "uz": "Tashqi xizmat xatosi", "ru": "Ошибка внешнего сервиса"}', 500)
on conflict do nothing;

insert into service_category(code, name) values
('MOBILE_OPERATORS', '{"en": "Mobile operators", "uz": "Mobil aloqa operatorlari", "ru": "Мобильные операторы"}'),
('INTERNET', '{"en": "Internet", "uz": "Internet", "ru": "Интернет"}'),
('TV', '{"en": "TV", "uz": "TV", "ru": "ТВ"}'),
('TELEPHONY', '{"en": "Telephony", "uz": "Telefoniya", "ru": "Телефония"}'),
('UTILITIES', '{"en": "Utilities", "uz": "Komunal xizmatlar", "ru": "Коммунальные услуги"}'),
('TAXI', '{"en": "Taxi", "uz": "Taksi", "ru": "Такси"}'),
('TRANSPORT', '{"en": "Transport", "uz": "Transport", "ru": "Транспорт"}'),
('ENTERTAINMENT', '{"en": "Entertainment", "uz": "Ko''ngilochar xizmatlar", "ru": "Развлечения"}'),
('EDUCATION', '{"en": "Education", "uz": "Ta''lim", "ru": "Образование"}'),
('GOVERNMENT', '{"en": "Government services", "uz": "Davlat xizmatlari", "ru": "Государственные услуги"}'),
('ONLINE_SERVICES', '{"en": "Online services", "uz": "Onlayn xizmatlar", "ru": "Онлайн услуги"}'),
('INSURANCE', '{"en": "Insurance", "uz": "Sug''urta", "ru": "Страхование"}'),
('BANKS', '{"en": "Banks", "uz": "Banklar", "ru": "Банки"}'),
('AIRLINE_TRAIN_TICKETS', '{"en": "Airline and train tickets", "uz": "Avia va temir yo''l chiptalari", "ru": "Авиа и ж/д билеты"}'),
('REAL_ESTATE', '{"en": "Real estate", "uz": "Uy-joy", "ru": "Недвижимость"}'),
('MEDICINE', '{"en": "Medicine", "uz": "Tibbiyot", "ru": "Медицина"}'),
('TOURISM', '{"en": "Tourism", "uz": "Turizm", "ru": "Туризм"}'),
('SPORT', '{"en": "Sport", "uz": "Sport", "ru": "Спорт"}'),
('E_COMMERCE', '{"en": "E-commerce", "uz": "Internet magazinlar", "ru": "Интернет магазины"}'),
('OTHER', '{"en": "Other", "uz": "Boshqa", "ru": "Другое"}')
on conflict do nothing;
