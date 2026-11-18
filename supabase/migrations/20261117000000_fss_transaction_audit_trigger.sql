-- ============================================================================
-- FSS SCHEMA: TRANSACTION AUDIT TRIGGER & SYNC
-- Attaches the audit trigger to fss.fss_table_transactions so any INSERT,
-- UPDATE, or DELETE is automatically logged to fss.fss_audit_log,
-- exactly like public.fss_table_transactions.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION fss.fss_log_transaction_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fss, pg_catalog, public
AS $function$
DECLARE
  v_before jsonb;
  v_after jsonb;
  v_transaction jsonb;
  v_action text;
  v_user_id uuid;
  v_summary text;
BEGIN
  IF tg_op = 'UPDATE' THEN
    IF (to_jsonb(old) - 'updated_at') IS NOT DISTINCT FROM (to_jsonb(new) - 'updated_at') THEN
      RETURN new;
    END IF;
  END IF;

  IF tg_op = 'INSERT' THEN
    v_before := null;
    v_after := to_jsonb(new);
    v_transaction := v_after;
    v_action := 'create';
  ELSIF tg_op = 'DELETE' THEN
    v_before := to_jsonb(old);
    v_after := null;
    v_transaction := v_before;
    v_action := 'delete';
  ELSE
    v_before := to_jsonb(old);
    v_after := to_jsonb(new);
    v_transaction := v_after;
    v_action := CASE
      WHEN lower(coalesce(old.status, '')) NOT LIKE '%cancel%'
        AND lower(coalesce(new.status, '')) LIKE '%cancel%' THEN 'delete'
      WHEN lower(coalesce(old.status, '')) LIKE '%cancel%'
        AND lower(coalesce(new.status, '')) NOT LIKE '%cancel%' THEN 'restore'
      ELSE 'update'
    END;
  END IF;

  v_user_id := auth.uid();
  v_summary := initcap(v_action) || ' transaction · ' ||
    coalesce(nullif(v_transaction ->> 'description', ''), nullif(v_transaction ->> 'category', ''), 'Transaction');

  INSERT INTO fss.fss_audit_log (
    user_id,
    user_name,
    action,
    record_type,
    record_id,
    summary,
    changes,
    created_at
  ) VALUES (
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

  IF tg_op = 'DELETE' THEN
    RETURN old;
  END IF;
  RETURN new;
END;
$function$;

GRANT EXECUTE ON FUNCTION fss.fss_log_transaction_change TO anon, authenticated, service_role;

DROP TRIGGER IF EXISTS fss_table_transactions_audit_log
  ON fss.fss_table_transactions;

CREATE TRIGGER fss_table_transactions_audit_log
AFTER INSERT OR UPDATE OR DELETE
ON fss.fss_table_transactions
FOR EACH ROW
EXECUTE FUNCTION fss.fss_log_transaction_change();

COMMIT;

