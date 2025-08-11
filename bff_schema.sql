-- BFF Memory tables (dev-friendly RLS; tighten before prod)
create extension if not exists vector;
create extension if not exists pgcrypto;

create table if not exists bff_notes (
  id uuid primary key default gen_random_uuid(),
  content text,
  created_at timestamp default now()
);

alter table bff_notes enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'bff_notes' and policyname = 'dev_allow_all'
  ) then
    create policy dev_allow_all on bff_notes for all using (true) with check (true);
  end if;
end$$;
