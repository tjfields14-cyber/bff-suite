create extension if not exists vector;
drop table if exists repo_files;
create table repo_files (
  id bigserial primary key,
  path text not null unique,
  content text,
  embedding vector(1536)
);
