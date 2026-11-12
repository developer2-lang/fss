begin;

alter table public.fss_audit_log
  alter column user_id drop not null;

grant insert on table public.fss_audit_log to anon, authenticated;

drop policy if exists "Allow anonymous audit inserts" on public.fss_audit_log;
create policy "Allow anonymous audit inserts"
  on public.fss_audit_log
  for insert
  to anon, authenticated
  with check (true);

commit;
