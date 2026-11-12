begin;

create or replace function public.fss_log_transaction_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_before jsonb;
  v_after jsonb;
  v_transaction jsonb;
  v_action text;
  v_user_id uuid;
  v_summary text;
begin
  if tg_op = 'UPDATE' then
    if (to_jsonb(old) - 'updated_at') is not distinct from (to_jsonb(new) - 'updated_at') then
      return new;
    end if;
  end if;

  if tg_op = 'INSERT' then
    v_before := null;
    v_after := to_jsonb(new);
    v_transaction := v_after;
    v_action := 'create';
  elsif tg_op = 'DELETE' then
    v_before := to_jsonb(old);
    v_after := null;
    v_transaction := v_before;
    v_action := 'delete';
  else
    v_before := to_jsonb(old);
    v_after := to_jsonb(new);
    v_transaction := v_after;
    v_action := case
      when lower(coalesce(old.status, '')) not like '%cancel%'
        and lower(coalesce(new.status, '')) like '%cancel%' then 'delete'
      when lower(coalesce(old.status, '')) like '%cancel%'
        and lower(coalesce(new.status, '')) not like '%cancel%' then 'restore'
      else 'update'
    end;
  end if;

  v_user_id := auth.uid();
  v_summary := initcap(v_action) || ' transaction · ' ||
    coalesce(nullif(v_transaction ->> 'description', ''), nullif(v_transaction ->> 'category', ''), 'Transaction');

  insert into public.fss_audit_log (
    user_id,
    user_name,
    action,
    record_type,
    record_id,
    summary,
    changes,
    created_at
  ) values (
    v_user_id,
    coalesce(
      nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', ''),
      'System'
    ),
    v_action,
    'entries',
    v_transaction ->> 'id',
    v_summary,
    jsonb_build_object('before', v_before, 'after', v_after),
    now()
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

revoke all on function public.fss_log_transaction_change() from public;

drop trigger if exists fss_table_transactions_audit_log
  on public.fss_table_transactions;

create trigger fss_table_transactions_audit_log
after insert or update or delete
on public.fss_table_transactions
for each row
execute function public.fss_log_transaction_change();

commit;
