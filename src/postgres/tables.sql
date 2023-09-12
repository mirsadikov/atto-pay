create database atto_project;

\c atto_project

create extension if not exists "uuid-ossp";

create table if not exists customer(
  id uuid primary key default uuid_generate_v4(),
  name varchar(64) not null,
  phone varchar(12) not null unique,
  hashed_password text not null,
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
)