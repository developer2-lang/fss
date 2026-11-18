begin;

create or replace function public.fss_insert_audit_log(
  p_user_name text,
  p_action text,
  p_record_type text,
  p_record_id text,
  p_summary text,
  p_changes jsonb,
  p_created_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_row public.fss_audit_log%rowtype;
begin
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
    null,
    coalesce(nullif(btrim(p_user_name), ''), 'App user'),
    coalesce(nullif(btrim(p_action), ''), 'update'),
    coalesce(nullif(btrim(p_record_type), ''), 'unknown'),
    coalesce(p_record_id, ''),
    coalesce(p_summary, ''),
    coalesce(p_changes, '{}'::jsonb),
    coalesce(p_created_at, now())
  )
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'created_at', v_row.created_at,
    'user_id', v_row.user_id,
    'user_name', v_row.user_name,
    'action', v_row.action,
    'record_type', v_row.record_type,
    'record_id', v_row.record_id,
    'summary', v_row.summary,
    'changes', v_row.changes
  );
end;
$function$;

revoke all on function public.fss_insert_audit_log(
  text, text, text, text, text, jsonb, timestamptz
) from public;
grant execute on function public.fss_insert_audit_log(
  text, text, text, text, text, jsonb, timestamptz
) to anon, authenticated;

commit;
