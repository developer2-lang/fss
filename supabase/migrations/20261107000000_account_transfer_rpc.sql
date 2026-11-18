begin;

alter table public.fss_table_transactions
  add column if not exists transfer_from_account_id bigint references public.fss_bank_accounts(id),
  add column if not exists transfer_to_account_id bigint references public.fss_bank_accounts(id),
  add column if not exists transfer_from_account_name text,
  add column if not exists transfer_to_account_name text,
  add column if not exists transfer_deleted_at timestamptz,
  add column if not exists transfer_deleted_by text;

create index if not exists idx_fss_table_transactions_transfer_accounts
  on public.fss_table_transactions (transfer_from_account_id, transfer_to_account_id)
  where transaction_type = 'Transfer';

create or replace function public.fss_account_transfer_upsert(
  p_transfer_id text,
  p_from_account_id bigint,
  p_to_account_id bigint,
  p_amount numeric,
  p_transaction_date date,
  p_payment_mode text,
  p_reference text,
  p_description text,
  p_notes text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_existing public.fss_table_transactions%rowtype;
  v_from public.fss_bank_accounts%rowtype;
  v_to public.fss_bank_accounts%rowtype;
  v_row public.fss_table_transactions%rowtype;
begin
  if p_from_account_id is null or p_to_account_id is null then
    raise exception 'Choose both the source and destination accounts.';
  end if;
  if p_from_account_id = p_to_account_id then
    raise exception 'Source and destination accounts must differ.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Transfer amount must be greater than zero.';
  end if;
  if p_transaction_date is null then
    raise exception 'Transaction date is required.';
  end if;
  if nullif(btrim(p_payment_mode), '') is null then
    raise exception 'Payment mode is required.';
  end if;

  if nullif(btrim(p_transfer_id), '') is not null then
    select * into v_existing
    from public.fss_table_transactions
    where id::text = p_transfer_id
    for update;

    if not found or v_existing.transaction_type <> 'Transfer' then
      raise exception 'Account transfer was not found.';
    end if;
  end if;

  perform id
  from public.fss_bank_accounts
  where id = any(array[
    p_from_account_id,
    p_to_account_id,
    v_existing.transfer_from_account_id,
    v_existing.transfer_to_account_id
  ]::bigint[])
  order by id
  for update;

  select * into v_from
  from public.fss_bank_accounts
  where id = p_from_account_id;
  if not found then
    raise exception 'The source account does not exist.';
  end if;

  select * into v_to
  from public.fss_bank_accounts
  where id = p_to_account_id;
  if not found then
    raise exception 'The destination account does not exist.';
  end if;

  if nullif(btrim(p_transfer_id), '') is not null then
    update public.fss_table_transactions
    set transaction_date = p_transaction_date,
        transaction_type = 'Transfer',
        category = 'Account Transfer',
        description = coalesce(nullif(btrim(p_description), ''), 'Account transfer'),
        reference_number = nullif(btrim(p_reference), ''),
        taxable_amount = round(p_amount, 2),
        gst_rate = 0,
        gst_amount = 0,
        tds_amount = 0,
        net_cash = round(p_amount, 2),
        account_name = v_from.account_name,
        payment_mode = btrim(p_payment_mode),
        financial_year = case
          when extract(month from p_transaction_date) >= 4
            then extract(year from p_transaction_date)::int::text || '-' ||
                 right((extract(year from p_transaction_date)::int + 1)::text, 2)
          else (extract(year from p_transaction_date)::int - 1)::text || '-' ||
               right(extract(year from p_transaction_date)::int::text, 2)
        end,
        notes = nullif(btrim(p_notes), ''),
        status = 'Active',
        transfer_from_account_id = p_from_account_id,
        transfer_to_account_id = p_to_account_id,
        transfer_from_account_name = v_from.account_name,
        transfer_to_account_name = v_to.account_name,
        transfer_deleted_at = null,
        transfer_deleted_by = null,
        updated_at = now()
    where id::text = p_transfer_id
    returning * into v_row;
  else
    insert into public.fss_table_transactions (
      transaction_date,
      transaction_type,
      category,
      description,
      reference_number,
      taxable_amount,
      gst_rate,
      gst_amount,
      tds_amount,
      net_cash,
      account_name,
      payment_mode,
      financial_year,
      notes,
      status,
      transfer_from_account_id,
      transfer_to_account_id,
      transfer_from_account_name,
      transfer_to_account_name,
      transfer_deleted_at,
      transfer_deleted_by,
      updated_at
    ) values (
      p_transaction_date,
      'Transfer',
      'Account Transfer',
      coalesce(nullif(btrim(p_description), ''), 'Account transfer'),
      nullif(btrim(p_reference), ''),
      round(p_amount, 2),
      0,
      0,
      0,
      round(p_amount, 2),
      v_from.account_name,
      btrim(p_payment_mode),
      case
        when extract(month from p_transaction_date) >= 4
          then extract(year from p_transaction_date)::int::text || '-' ||
               right((extract(year from p_transaction_date)::int + 1)::text, 2)
        else (extract(year from p_transaction_date)::int - 1)::text || '-' ||
             right(extract(year from p_transaction_date)::int::text, 2)
      end,
      nullif(btrim(p_notes), ''),
      'Active',
      p_from_account_id,
      p_to_account_id,
      v_from.account_name,
      v_to.account_name,
      null,
      null,
      now()
    )
    returning * into v_row;
  end if;

  return to_jsonb(v_row);
end;
$function$;

create or replace function public.fss_account_transfer_set_deleted(
  p_transfer_id text,
  p_deleted boolean,
  p_deleted_by text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_row public.fss_table_transactions%rowtype;
begin
  if p_deleted is null then
    raise exception 'Deleted state is required.';
  end if;

  update public.fss_table_transactions
  set status = case when p_deleted then 'Cancelled' else 'Active' end,
      transfer_deleted_at = case when p_deleted then now() else null end,
      transfer_deleted_by = case when p_deleted then nullif(btrim(p_deleted_by), '') else null end,
      updated_at = now()
  where id::text = p_transfer_id
    and transaction_type = 'Transfer'
  returning * into v_row;

  if not found then
    raise exception 'Account transfer was not found.';
  end if;

  return to_jsonb(v_row);
end;
$function$;

create or replace function public.fss_account_transfer_delete(
  p_transfer_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_row public.fss_table_transactions%rowtype;
begin
  delete from public.fss_table_transactions
  where id::text = p_transfer_id
    and transaction_type = 'Transfer'
  returning * into v_row;

  if not found then
    raise exception 'Account transfer was not found.';
  end if;

  return to_jsonb(v_row);
end;
$function$;

revoke all on function public.fss_account_transfer_upsert(text, bigint, bigint, numeric, date, text, text, text, text) from public;
revoke all on function public.fss_account_transfer_set_deleted(text, boolean, text) from public;
revoke all on function public.fss_account_transfer_delete(text) from public;
grant execute on function public.fss_account_transfer_upsert(text, bigint, bigint, numeric, date, text, text, text, text) to anon, authenticated;
grant execute on function public.fss_account_transfer_set_deleted(text, boolean, text) to anon, authenticated;
grant execute on function public.fss_account_transfer_delete(text) to anon, authenticated;

commit;
