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

create table if not exists customer_card(
  id uuid primary key default uuid_generate_v4(),
  customer_id uuid not null references customer(id),
  name varchar(64) not null,
  pan varchar(16) not null unique,
  expiry_month varchar(2) not null,
  expiry_year varchar(2) not null,
  balance numeric(10, 2) not null default 1000000,
  constraint unique_customer_pan unique(customer_id, pan)
);

create table if not exists customer_device(
  id serial primary key,
  customer_id uuid not null references customer(id),
  device_id varchar(64) not null,
  constraint unique_customer_device unique(customer_id, device_id)
);

create table if not exists error(
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
  balance numeric(10, 2) not null default (random() * 3000000),
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
  price int not null,
  image_url varchar(256),
  is_active boolean not null default false,
  deleted boolean not null default false
);

create unique index if not exists unique_merchant_category on service(merchant_id, category_id) where deleted = false;

create table if not exists customer_saved_service(
  customer_id uuid not null references customer(id),
  service_id uuid not null references service(id),
  constraint unique_customer_service unique(customer_id, service_id)
);

create table if not exists customer_payment (
  id uuid primary key default uuid_generate_v4(),
  customer_id uuid not null references customer(id),
  from_card_id uuid not null references customer_card(id),
  service_id uuid not null references service(id),
  amount int not null,
  created_at timestamp not null default now()
);

create table if not exists customer_transfer (
  id uuid primary key default uuid_generate_v4(),
  customer_id uuid not null references customer(id),
  from_card_id uuid not null references customer_card(id),
  receiver_id uuid not null references customer(id),
  amount int not null,
  created_at timestamp not null default now()
);


-- ############################
-- UTILITY PROCEDURES --
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
create or replace procedure delete_card(
  _card_id uuid,
  _customer_id uuid,
  out error_code varchar(64),
  out error_message text
) as $$
begin
  begin
    delete from customer_payment where from_card_id = _card_id;
    delete from customer_transfer where from_card_id = _card_id;
  
    delete from customer_card where id = _card_id and customer_id = _customer_id;
    if not found then 
      error_code := 'CARD_NOT_FOUND';
      return;
    end if;
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

create or replace procedure pay_for_service(
  _customer_id uuid,
  _card_id uuid,
  _service_id uuid,
  out payment_id uuid,
  out error_code varchar(64),
  out error_message text
)
as $$
declare
  result jsonb;
  service_row service;
  card_row customer_card;
  merchant_row merchant;
begin
  begin
    select * into service_row from service where id = _service_id and deleted = false;
    if not found then 
      error_code := 'SERVICE_NOT_FOUND';
      return;
    end if;

    select * into card_row from customer_card where id = _card_id and customer_id = _customer_id;
    if not found then 
      error_code := 'CARD_NOT_FOUND';
      return;
    end if;

    if card_row.balance < service_row.price then 
      error_code := 'INSUFFICIENT_FUNDS';
      return;
    end if;

    insert into customer_payment (customer_id, from_card_id, service_id, amount) 
    values (_customer_id, card_row.id, _service_id, service_row.price) returning id into payment_id;

    update customer_card set balance = balance - service_row.price where id = _card_id;
    update merchant set balance = balance + service_row.price where id = service_row.merchant_id;
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

create or replace procedure transfer_money(
  _customer_id uuid,
  _from_id uuid,
  _to_pan varchar(16),
  _amount int,
  out transfer_id uuid,
  out error_code varchar(64),
  out error_message text
) as $$
declare
  from_row customer_card;
  to_row customer_card;
begin
  begin
    select * into from_row from customer_card where id = _from_id and customer_id = _customer_id;
    if not found then 
      error_code := 'CARD_NOT_FOUND';
      return;
    end if;

    select * into to_row from customer_card where pan = _to_pan;
    if not found then 
      error_code := 'CARD_NOT_FOUND';
      return;
    end if;

    if from_row.balance < _amount then 
      error_code := 'INSUFFICIENT_FUNDS';
      return;
    end if;

    insert into customer_transfer (customer_id, from_card_id, receiver_id, amount)
    values (_customer_id, _from_id, to_row.customer_id, _amount) returning id into transfer_id;

    update customer_card set balance = balance - _amount where id = from_row.id;
    update customer_card set balance = balance + _amount where id = to_row.id;
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

create or replace procedure transfer_money_to_self(
  _customer_id uuid,
  _from_id uuid,
  _to_id uuid,
  _amount int,
  out transfer_id uuid,
  out error_code varchar(64),
  out error_message text
) as $$
declare
  from_row customer_card;
  to_row customer_card;
begin
  begin
    select * into from_row from customer_card where id = _from_id and customer_id = _customer_id;
    if not found then 
      error_code := 'CARD_NOT_FOUND';
      return;
    end if;

    select * into to_row from customer_card where id = _to_id and customer_id = _customer_id;
    if not found then 
      error_code := 'CARD_NOT_FOUND';
      return;
    end if;

    if from_row.balance < _amount then 
      error_code := 'INSUFFICIENT_FUNDS';
      return;
    end if;

    insert into customer_transfer (customer_id, from_card_id, receiver_id, amount)
    values (_customer_id, _from_id, to_row.customer_id, _amount) returning id into transfer_id;

    update customer_card set balance = balance - _amount where id = from_row.id;
    update customer_card set balance = balance + _amount where id = to_row.id;
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
-- DATA INSERTION --
insert into error(name, message, http_code) values
('VALIDATION_ERROR', '{"en": "Invalid input for {0}", "uz": "{0} uchun notog''ri kiritish", "ru": "Неверный ввод для {0}"}', 400),
('DATABASE_ERROR', '{"en": "Database error", "uz": "Ma''lumotlar bazasi xatosi", "ru": "Ошибка базы данных"}', 500),
('NUMBER_TAKEN', '{"en": "This phone number is already registered", "uz": "Bu telefon raqami allaqachon ro''yhatdan o''tgan", "ru": "Этот номер телефона уже зарегистрирован"}', 409),
('USER_NOT_FOUND', '{"en": "User not found", "uz": "Foydalanuvchi topilmadi", "ru": "Пользователь не найден"}', 404),
('WRONG_PASSWORD', '{"en": "Wrong password", "uz": "Noto''g''ri parol", "ru": "Неверный пароль"}', 401),
('MISSING_TOKEN', '{"en": "Missing token", "uz": "Token topilmadi", "ru": "Отсутствует токен"}', 401),
('INVALID_TOKEN', '{"en": "Invalid token", "uz": "Noto''g''ri token", "ru": "Неверный токен"}', 401),
('EXPIRED_TOKEN', '{"en": "Expired token", "uz": "Muddati o''tgan token", "ru": "Истекший токен"}', 401),
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
('NOT_ALLOWED', '{"en": "Not allowed", "uz": "Ruxsat etilmagan", "ru": "Не разрешено"}', 403),
('SERVICE_ALREADY_EXISTS', '{"en": "Adding multiple services in one category is not allowed", "uz": "Bitta kategoriyada bir nechta xizmat qo''shib bo''lmaydi", "ru": "Нельзя добавить несколько услуг в одну категорию"}', 409),
('SERVICE_NOT_FOUND', '{"en": "Service not found", "uz": "Xizmat topilmadi", "ru": "Услуга не найдена"}', 404),
('INSUFFICIENT_FUNDS', '{"en": "Insufficient funds", "uz": "Mablag'' yetarli emas", "ru": "Недостаточно средств"}', 400),
('TRANSACTION_ERROR', '{"en": "Transaction error", "uz": "Tranzaksiyada xatolik", "ru": "Ошибка транзакции"}', 500)
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
('OTHER', '{"en": "Other", "uz": "Boshqa", "ru": "Другое"}'),
('USER_SAVED', '{"en": "Saved services", "uz": "Saqlangan xizmatlar", "ru": "Сохраненные услуги"}')
on conflict do nothing;
