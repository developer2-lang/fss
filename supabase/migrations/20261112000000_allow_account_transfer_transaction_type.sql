begin;

-- Account transfers are stored in the same transaction table and need their
-- own transaction_type so they can be filtered and edited independently.
alter table public.fss_table_transactions
  drop constraint if exists fss_table_transactions_transaction_type_check;

alter table public.fss_table_transactions
  add constraint fss_table_transactions_transaction_type_check
  check (transaction_type in ('Inflow', 'Outflow', 'Transfer'));

commit;
