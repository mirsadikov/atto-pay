create database project;

\c project

create extension if not exists "uuid-ossp";

create table users(
  id uuid default uuid_generate_v4(),
  name varchar(64) not null,
  age int
);
