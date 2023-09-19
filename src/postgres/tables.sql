create extension if not exists "uuid-ossp";

drop table if exists customer_device;
drop table if exists customer_card;
drop table if exists customer;
drop table if exists error;

create table if not exists customer(
  id uuid primary key default uuid_generate_v4(),
  name varchar(64) not null,
  phone varchar(12) not null unique,
  photo_url varchar(256),
  hashed_password text not null,
  reg_date timestamp not null default now(),
  is_blocked boolean not null default false,
  login_attempts int not null default 0,
  last_login_attempt timestamp
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

insert into error(name, message, http_code) values
('INVALID_INPUT', '{"en": "Invalid input", "uz": "Ma''lumotlar notog''ri", "ru": "Некорректный ввод"}', 400),
('VALIDATION_ERROR', '{"en": "Validation error", "uz": "Validatsiya xatosi", "ru": "Ошибка валидации"}', 400),
('DATABASE_ERROR', '{"en": "Database error", "uz": "Ma''lumotlar bazasi xatosi", "ru": "Ошибка базы данных"}', 500),
('USER_EXISTS', '{"en": "User already exists", "uz": "Foydalanuvchi allaqachon mavjud", "ru": "Пользователь уже существует"}', 409),
('USER_NOT_FOUND', '{"en": "User not found", "uz": "Foydalanuvchi topilmadi", "ru": "Пользователь не найден"}', 404),
('WRONG_PASSWORD', '{"en": "Wrong password", "uz": "Noto''g''ri parol", "ru": "Неверный пароль"}', 401),
('MISSING_TOKEN', '{"en": "Missing token", "uz": "Token topilmadi", "ru": "Отсутствует токен"}', 401),
('INVALID_TOKEN', '{"en": "Invalid token", "uz": "Noto''g''ri token", "ru": "Неверный токен"}', 401),
('EXPIRED_TOKEN', '{"en": "Expired token", "uz": "Muddati o''tgan token", "ru": "Истекший токен"}', 401),
('INVALID_EXPIRY_DATE', '{"en": "Invalid expiration date", "uz": "Amal qilish muddati noto''g''ri", "ru": "Неверный срок действия"}', 400),
('CARD_EXPIRED', '{"en": "Card expired", "uz": "Karta muddati tugagan", "ru": "Срок действия карты истек"}', 400),
('CARD_ALREADY_ADDED', '{"en": "Card already added", "uz": "Karta allaqachon qo''shilgan", "ru": "Карта уже добавлена"}', 409),
('CARD_NOT_FOUND', '{"en": "Card not found", "uz": "Karta topilmadi", "ru": "Карта не найдена"}', 404),
('ERROR', '{"en": "Internal server error", "uz": "Server xatosi", "ru": "Ошибка сервера"}', 500),
('FILE_EXTENSION_ERROR', '{"en": "This type of file is not allowed", "uz": "Bu turga ega fayllar ruxsat etilmagan", "ru": "Этот тип файла не разрешен"}', 400),
('FILE_UPLOAD_ERROR', '{"en": "Error while uploading file", "uz": "Fayl yuklashda xatolik", "ru": "Ошибка при загрузке файла"}', 500),
('FILE_NOT_ATTACHED', '{"en": "File is not provided", "uz": "Fayl berilmagan", "ru": "Файл не предоставлен"}', 400),
('FILE_DELETE_ERROR', '{"en": "Error while deleting file", "uz": "Fayl o''chirishda xatolik", "ru": "Ошибка при удалении файла"}', 500),
('FILE_NOT_FOUND', '{"en": "File not found", "uz": "Fayl topilmadi", "ru": "Файл не найден"}', 404),
('FILE_READER_ERROR', '{"en": "Error while reading file", "uz": "Faylni o''qishda xatolik", "ru": "Ошибка при чтении файла"}', 500),
('USER_BLOCKED', '{"en": "User is blocked, try again later", "uz": "Foydalanuvchi bloklangan, keyinroq urinib ko''ring", "ru": "Пользователь заблокирован, попробуйте позже"}', 403),
('WRONG_OTP', '{"en": "Wrong verification code", "uz": "Tekshirish kodi noto''g''ri", "ru": "Неверный код подтверждения"}', 400),
('EXPIRED_OTP', '{"en": "Verification code is expired", "uz": "Tasdiqlash kodi eskirgan", "ru": "Код подтверждения истек"}', 400);