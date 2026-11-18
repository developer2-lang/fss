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
  v_amount numeric;
  v_amount_text text;
  v_details text;
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
  v_amount := abs(coalesce(
    nullif(v_transaction ->> 'net_cash', '')::numeric,
    nullif(v_transaction ->> 'taxable_amount', '')::numeric,
    0
  ));
  v_amount_text := case
    when v_amount = trunc(v_amount) then to_char(v_amount, 'FM999,999,999,999,990')
    else to_char(v_amount, 'FM999,999,999,999,990.00')
  end;
  v_details := concat_ws(
    ' · ',
    nullif(v_transaction ->> 'category', ''),
    nullif(v_transaction ->> 'party_name', ''),
    nullif(v_transaction ->> 'project_name', '')
  );
  v_summary := concat_ws(
    ' · ',
    concat(
      coalesce(nullif(v_transaction ->> 'transaction_type', ''), 'Transaction'),
      ' ₹',
      v_amount_text
    ),
    nullif(v_details, '')
  );

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

commit;
