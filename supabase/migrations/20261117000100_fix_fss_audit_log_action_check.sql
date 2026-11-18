BEGIN;

DO $$
DECLARE
  v_schema text;
  v_table regclass;
BEGIN
  FOREACH v_schema IN ARRAY ARRAY['public', 'fss'] LOOP
    v_table := to_regclass(format('%I.fss_audit_log', v_schema));
    IF v_table IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'ALTER TABLE %I.fss_audit_log DROP CONSTRAINT IF EXISTS fss_audit_log_action_check',
      v_schema
    );
    EXECUTE format(
      'UPDATE %I.fss_audit_log SET action = lower(btrim(action)) WHERE action IS NOT NULL',
      v_schema
    );
    EXECUTE format(
      'ALTER TABLE %I.fss_audit_log ADD CONSTRAINT fss_audit_log_action_check CHECK (action IS NULL OR (action = lower(btrim(action)) AND length(btrim(action)) > 0))',
      v_schema
    );
  END LOOP;
END;
$$;

COMMIT;
