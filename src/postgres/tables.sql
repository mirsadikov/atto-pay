create database atto_project;

\c atto_project

create extension if not exists "uuid-ossp";

-- drop table if exists customer;
create table if not exists customer(
  id uuid primary key default uuid_generate_v4(),
  name varchar(64) not null,
  phone varchar(12) not null unique,
  hashed_password text not null,
  reg_date timestamp not null default now()
);
