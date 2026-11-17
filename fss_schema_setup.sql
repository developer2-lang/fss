-- ============================================================================
-- FSS SCHEMA SETUP: PERMISSIONS, RLS POLICIES, VIEWS & RPC FUNCTIONS
-- Run this script in the Supabase SQL Editor to make `fss` the active schema
-- ============================================================================

BEGIN;

-- 1. Ensure Schema and Grant Permissions to Supabase API Roles
CREATE SCHEMA IF NOT EXISTS fss;

GRANT USAGE ON SCHEMA fss TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA fss TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA fss TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA fss TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA fss GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA fss GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA fss GRANT ALL ON ROUTINES TO anon, authenticated, service_role;

-- 2. Enable Row Level Security (RLS) & Grant Policies on All Existing FSS Tables
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'fss') LOOP
    EXECUTE format('ALTER TABLE fss.%I ENABLE ROW LEVEL SECURITY;', r.tablename);
    EXECUTE format('DROP POLICY IF EXISTS "Allow all actions on %I" ON fss.%I;', r.tablename, r.tablename);
    EXECUTE format('CREATE POLICY "Allow all actions on %I" ON fss.%I FOR ALL USING (true) WITH CHECK (true);', r.tablename, r.tablename);
  END LOOP;
END $$;

-- 3. Copy Missing Account Summary Table If Not Present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_schema = 'fss' AND table_name = 'fss_by_account_credited_debited'
  ) THEN
    CREATE TABLE fss.fss_by_account_credited_debited (
      LIKE public.fss_by_account_credited_debited INCLUDING ALL
    );
    INSERT INTO fss.fss_by_account_credited_debited
    SELECT * FROM public.fss_by_account_credited_debited
    ON CONFLICT DO NOTHING;

    ALTER TABLE fss.fss_by_account_credited_debited ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "Allow all actions on fss_by_account_credited_debited"
      ON fss.fss_by_account_credited_debited FOR ALL USING (true) WITH CHECK (true);
    GRANT ALL ON TABLE fss.fss_by_account_credited_debited TO anon, authenticated, service_role;
  END IF;
END $$;

-- 4. Create fss.fss_cash_inflow View
CREATE OR REPLACE VIEW fss.fss_cash_inflow AS
WITH summary AS (
  SELECT
    'Operating Receipts'::text AS row_name,
    COALESCE(SUM(jan_26), 0)::numeric AS jan_26,
    COALESCE(SUM(feb_26), 0)::numeric AS feb_26,
    COALESCE(SUM(mar_26), 0)::numeric AS mar_26,
    COALESCE(SUM(apr_26), 0)::numeric AS apr_26,
    COALESCE(SUM(may_26), 0)::numeric AS may_26,
    COALESCE(SUM(jun_26), 0)::numeric AS jun_26,
    COALESCE(SUM(jul_26), 0)::numeric AS jul_26,
    COALESCE(SUM(aug_26), 0)::numeric AS aug_26,
    COALESCE(SUM(sep_26), 0)::numeric AS sep_26,
    COALESCE(SUM(oct_26), 0)::numeric AS oct_26,
    COALESCE(SUM(nov_26), 0)::numeric AS nov_26,
    COALESCE(SUM(dec_26), 0)::numeric AS dec_26,
    COALESCE(SUM(fy_to_date), 0)::numeric AS fy_to_date,
    1 AS sort_order
  FROM fss.fss_operation_receipts
  UNION ALL
  SELECT
    'Other Income'::text AS row_name,
    COALESCE(SUM(jan_26), 0)::numeric AS jan_26,
    COALESCE(SUM(feb_26), 0)::numeric AS feb_26,
    COALESCE(SUM(mar_26), 0)::numeric AS mar_26,
    COALESCE(SUM(apr_26), 0)::numeric AS apr_26,
    COALESCE(SUM(may_26), 0)::numeric AS may_26,
    COALESCE(SUM(jun_26), 0)::numeric AS jun_26,
    COALESCE(SUM(jul_26), 0)::numeric AS jul_26,
    COALESCE(SUM(aug_26), 0)::numeric AS aug_26,
    COALESCE(SUM(sep_26), 0)::numeric AS sep_26,
    COALESCE(SUM(oct_26), 0)::numeric AS oct_26,
    COALESCE(SUM(nov_26), 0)::numeric AS nov_26,
    COALESCE(SUM(dec_26), 0)::numeric AS dec_26,
    COALESCE(SUM(fy_to_date), 0)::numeric AS fy_to_date,
    2 AS sort_order
  FROM fss.fss_income
  UNION ALL
  SELECT
    'Financing'::text AS row_name,
    COALESCE(SUM(jan_26), 0)::numeric AS jan_26,
    COALESCE(SUM(feb_26), 0)::numeric AS feb_26,
    COALESCE(SUM(mar_26), 0)::numeric AS mar_26,
    COALESCE(SUM(apr_26), 0)::numeric AS apr_26,
    COALESCE(SUM(may_26), 0)::numeric AS may_26,
    COALESCE(SUM(jun_26), 0)::numeric AS jun_26,
    COALESCE(SUM(jul_26), 0)::numeric AS jul_26,
    COALESCE(SUM(aug_26), 0)::numeric AS aug_26,
    COALESCE(SUM(sep_26), 0)::numeric AS sep_26,
    COALESCE(SUM(oct_26), 0)::numeric AS oct_26,
    COALESCE(SUM(nov_26), 0)::numeric AS nov_26,
    COALESCE(SUM(dec_26), 0)::numeric AS dec_26,
    COALESCE(SUM(fy_to_date), 0)::numeric AS fy_to_date,
    3 AS sort_order
  FROM fss.fss_financing
),
total AS (
  SELECT
    'CASH INFLOW'::text AS row_name,
    COALESCE(SUM(jan_26), 0)::numeric AS jan_26,
    COALESCE(SUM(feb_26), 0)::numeric AS feb_26,
    COALESCE(SUM(mar_26), 0)::numeric AS mar_26,
    COALESCE(SUM(apr_26), 0)::numeric AS apr_26,
    COALESCE(SUM(may_26), 0)::numeric AS may_26,
    COALESCE(SUM(jun_26), 0)::numeric AS jun_26,
    COALESCE(SUM(jul_26), 0)::numeric AS jul_26,
    COALESCE(SUM(aug_26), 0)::numeric AS aug_26,
    COALESCE(SUM(sep_26), 0)::numeric AS sep_26,
    COALESCE(SUM(oct_26), 0)::numeric AS oct_26,
    COALESCE(SUM(nov_26), 0)::numeric AS nov_26,
    COALESCE(SUM(dec_26), 0)::numeric AS dec_26,
    COALESCE(SUM(fy_to_date), 0)::numeric AS fy_to_date,
    4 AS sort_order
  FROM summary
),
combined AS (
  SELECT * FROM summary
  UNION ALL
  SELECT * FROM total
)
SELECT
  row_name,
  jan_26, feb_26, mar_26, apr_26, may_26, jun_26, jul_26, aug_26, sep_26, oct_26, nov_26, dec_26,
  fy_to_date,
  CASE
    WHEN (SELECT fy_to_date FROM total) > 0 THEN ROUND((fy_to_date / (SELECT fy_to_date FROM total)) * 100, 2)
    ELSE 0
  END AS share
FROM combined
ORDER BY sort_order;

GRANT SELECT ON fss.fss_cash_inflow TO anon, authenticated, service_role;

-- 5. Create fss.fss_outflow_oc_people_report View
CREATE OR REPLACE VIEW fss.fss_outflow_oc_people_report AS
WITH base AS (
  SELECT
    category,
    COALESCE(jan_26, 0)::numeric AS jan_26,
    COALESCE(feb_26, 0)::numeric AS feb_26,
    COALESCE(mar_26, 0)::numeric AS mar_26,
    COALESCE(apr_26, 0)::numeric AS apr_26,
    COALESCE(may_26, 0)::numeric AS may_26,
    COALESCE(jun_26, 0)::numeric AS jun_26,
    COALESCE(jul_26, 0)::numeric AS jul_26,
    COALESCE(aug_26, 0)::numeric AS aug_26,
    COALESCE(sep_26, 0)::numeric AS sep_26,
    COALESCE(oct_26, 0)::numeric AS oct_26,
    COALESCE(nov_26, 0)::numeric AS nov_26,
    COALESCE(dec_26, 0)::numeric AS dec_26,
    (
      COALESCE(jan_26, 0) + COALESCE(feb_26, 0) + COALESCE(mar_26, 0) +
      COALESCE(apr_26, 0) + COALESCE(may_26, 0) + COALESCE(jun_26, 0) +
      COALESCE(jul_26, 0) + COALESCE(aug_26, 0) + COALESCE(sep_26, 0) +
      COALESCE(oct_26, 0) + COALESCE(nov_26, 0) + COALESCE(dec_26, 0)
    )::numeric AS fy_to_date,
    ROW_NUMBER() OVER (ORDER BY id) + 1 AS sort_order
  FROM fss.fss_outflow_oc_people
),
total AS (
  SELECT
    'People Total'::text AS category,
    COALESCE(SUM(jan_26), 0)::numeric AS jan_26,
    COALESCE(SUM(feb_26), 0)::numeric AS feb_26,
    COALESCE(SUM(mar_26), 0)::numeric AS mar_26,
    COALESCE(SUM(apr_26), 0)::numeric AS apr_26,
    COALESCE(SUM(may_26), 0)::numeric AS may_26,
    COALESCE(SUM(jun_26), 0)::numeric AS jun_26,
    COALESCE(SUM(jul_26), 0)::numeric AS jul_26,
    COALESCE(SUM(aug_26), 0)::numeric AS aug_26,
    COALESCE(SUM(sep_26), 0)::numeric AS sep_26,
    COALESCE(SUM(oct_26), 0)::numeric AS oct_26,
    COALESCE(SUM(nov_26), 0)::numeric AS nov_26,
    COALESCE(SUM(dec_26), 0)::numeric AS dec_26,
    COALESCE(SUM(fy_to_date), 0)::numeric AS fy_to_date,
    1 AS sort_order
  FROM base
),
combined AS (
  SELECT * FROM total
  UNION ALL
  SELECT * FROM base
)
SELECT
  category,
  jan_26, feb_26, mar_26, apr_26, may_26, jun_26, jul_26, aug_26, sep_26, oct_26, nov_26, dec_26,
  fy_to_date,
  CASE
    WHEN (SELECT fy_to_date FROM total) > 0 THEN ROUND((fy_to_date / (SELECT fy_to_date FROM total)) * 100, 2)
    ELSE 0
  END AS share_pct,
  sort_order
FROM combined
ORDER BY sort_order;

GRANT SELECT ON fss.fss_outflow_oc_people_report TO anon, authenticated, service_role;

-- 6. Create RPC Functions in fss Schema

-- 6.1 fss_insert_audit_log
CREATE OR REPLACE FUNCTION fss.fss_insert_audit_log(
  p_user_name text,
  p_action text,
  p_record_type text,
  p_record_id text,
  p_summary text,
  p_changes jsonb,
  p_created_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fss, pg_catalog, public
AS $function$
DECLARE
  v_row fss.fss_audit_log%rowtype;
BEGIN
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
    null,
    coalesce(nullif(btrim(p_user_name), ''), 'App user'),
    coalesce(nullif(btrim(p_action), ''), 'update'),
    coalesce(nullif(btrim(p_record_type), ''), 'unknown'),
    coalesce(p_record_id, ''),
    coalesce(p_summary, ''),
    coalesce(p_changes, '{}'::jsonb),
    coalesce(p_created_at, now())
  )
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
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
END;
$function$;

GRANT EXECUTE ON FUNCTION fss.fss_insert_audit_log TO anon, authenticated, service_role;

-- Also update/create public alias so RPC calls resolve regardless of path
CREATE OR REPLACE FUNCTION public.fss_insert_audit_log(
  p_user_name text,
  p_action text,
  p_record_type text,
  p_record_id text,
  p_summary text,
  p_changes jsonb,
  p_created_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fss, pg_catalog, public
AS $function$
BEGIN
  RETURN fss.fss_insert_audit_log(p_user_name, p_action, p_record_type, p_record_id, p_summary, p_changes, p_created_at);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fss_insert_audit_log TO anon, authenticated, service_role;

-- 6.2 fss_account_transfer_upsert
CREATE OR REPLACE FUNCTION fss.fss_account_transfer_upsert(
  p_transfer_id text,
  p_from_account_id bigint,
  p_to_account_id bigint,
  p_amount numeric,
  p_transaction_date date,
  p_payment_mode text,
  p_reference text,
  p_description text,
  p_notes text DEFAULT null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = fss, public, pg_temp
AS $function$
DECLARE
  v_existing fss.fss_table_transactions%rowtype;
  v_from fss.fss_bank_accounts%rowtype;
  v_to fss.fss_bank_accounts%rowtype;
  v_row fss.fss_table_transactions%rowtype;
BEGIN
  IF p_from_account_id IS NULL OR p_to_account_id IS NULL THEN
    RAISE EXCEPTION 'Choose both the source and destination accounts.';
  END IF;
  IF p_from_account_id = p_to_account_id THEN
    RAISE EXCEPTION 'Source and destination accounts must differ.';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Transfer amount must be greater than zero.';
  END IF;
  IF p_transaction_date IS NULL THEN
    RAISE EXCEPTION 'Transaction date is required.';
  END IF;
  IF NULLIF(btrim(p_payment_mode), '') IS NULL THEN
    RAISE EXCEPTION 'Payment mode is required.';
  END IF;

  IF NULLIF(btrim(p_transfer_id), '') IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM fss.fss_table_transactions
    WHERE id::text = p_transfer_id
    FOR UPDATE;

    IF NOT FOUND OR v_existing.transaction_type <> 'Transfer' THEN
      RAISE EXCEPTION 'Account transfer was not found.';
    END IF;
  END IF;

  PERFORM id
  FROM fss.fss_bank_accounts
  WHERE id = ANY(ARRAY[
    p_from_account_id,
    p_to_account_id,
    v_existing.transfer_from_account_id,
    v_existing.transfer_to_account_id
  ]::bigint[])
  ORDER BY id
  FOR UPDATE;

  SELECT * INTO v_from
  FROM fss.fss_bank_accounts
  WHERE id = p_from_account_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The source account does not exist.';
  END IF;

  SELECT * INTO v_to
  FROM fss.fss_bank_accounts
  WHERE id = p_to_account_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The destination account does not exist.';
  END IF;

  IF NULLIF(btrim(p_transfer_id), '') IS NOT NULL THEN
    UPDATE fss.fss_table_transactions
    SET transaction_date = p_transaction_date,
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
        financial_year = CASE
          WHEN extract(month from p_transaction_date) >= 4
            THEN extract(year from p_transaction_date)::int::text || '-' ||
                 right((extract(year from p_transaction_date)::int + 1)::text, 2)
          ELSE (extract(year from p_transaction_date)::int - 1)::text || '-' ||
               right(extract(year from p_transaction_date)::int::text, 2)
        END,
        notes = nullif(btrim(p_notes), ''),
        status = 'Active',
        transfer_from_account_id = p_from_account_id,
        transfer_to_account_id = p_to_account_id,
        transfer_from_account_name = v_from.account_name,
        transfer_to_account_name = v_to.account_name,
        transfer_deleted_at = null,
        transfer_deleted_by = null,
        updated_at = now()
    WHERE id::text = p_transfer_id
    RETURNING * INTO v_row;
  ELSE
    INSERT INTO fss.fss_table_transactions (
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
    ) VALUES (
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
      CASE
        WHEN extract(month from p_transaction_date) >= 4
          THEN extract(year from p_transaction_date)::int::text || '-' ||
               right((extract(year from p_transaction_date)::int + 1)::text, 2)
        ELSE (extract(year from p_transaction_date)::int - 1)::text || '-' ||
             right(extract(year from p_transaction_date)::int::text, 2)
      END,
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
    RETURNING * INTO v_row;
  END IF;

  RETURN to_jsonb(v_row);
END;
$function$;

GRANT EXECUTE ON FUNCTION fss.fss_account_transfer_upsert TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fss_account_transfer_upsert(
  p_transfer_id text,
  p_from_account_id bigint,
  p_to_account_id bigint,
  p_amount numeric,
  p_transaction_date date,
  p_payment_mode text,
  p_reference text,
  p_description text,
  p_notes text DEFAULT null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = fss, public, pg_temp
AS $function$
BEGIN
  RETURN fss.fss_account_transfer_upsert(p_transfer_id, p_from_account_id, p_to_account_id, p_amount, p_transaction_date, p_payment_mode, p_reference, p_description, p_notes);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fss_account_transfer_upsert TO anon, authenticated, service_role;

-- 6.3 fss_account_transfer_set_deleted
CREATE OR REPLACE FUNCTION fss.fss_account_transfer_set_deleted(
  p_transfer_id text,
  p_deleted boolean,
  p_deleted_by text DEFAULT null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = fss, public, pg_temp
AS $function$
DECLARE
  v_row fss.fss_table_transactions%rowtype;
BEGIN
  IF p_deleted IS NULL THEN
    RAISE EXCEPTION 'Deleted state is required.';
  END IF;

  UPDATE fss.fss_table_transactions
  SET status = CASE WHEN p_deleted THEN 'Cancelled' ELSE 'Active' END,
      transfer_deleted_at = CASE WHEN p_deleted THEN now() ELSE null END,
      transfer_deleted_by = CASE WHEN p_deleted THEN nullif(btrim(p_deleted_by), '') ELSE null END,
      updated_at = now()
  WHERE id::text = p_transfer_id
    AND transaction_type = 'Transfer'
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account transfer was not found.';
  END IF;

  RETURN to_jsonb(v_row);
END;
$function$;

GRANT EXECUTE ON FUNCTION fss.fss_account_transfer_set_deleted TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fss_account_transfer_set_deleted(
  p_transfer_id text,
  p_deleted boolean,
  p_deleted_by text DEFAULT null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = fss, public, pg_temp
AS $function$
BEGIN
  RETURN fss.fss_account_transfer_set_deleted(p_transfer_id, p_deleted, p_deleted_by);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fss_account_transfer_set_deleted TO anon, authenticated, service_role;

-- 6.4 fss_account_transfer_delete
CREATE OR REPLACE FUNCTION fss.fss_account_transfer_delete(
  p_transfer_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = fss, public, pg_temp
AS $function$
DECLARE
  v_row fss.fss_table_transactions%rowtype;
BEGIN
  DELETE FROM fss.fss_table_transactions
  WHERE id::text = p_transfer_id
    AND transaction_type = 'Transfer'
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account transfer was not found.';
  END IF;

  RETURN to_jsonb(v_row);
END;
$function$;

GRANT EXECUTE ON FUNCTION fss.fss_account_transfer_delete TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fss_account_transfer_delete(
  p_transfer_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = fss, public, pg_temp
AS $function$
BEGIN
  RETURN fss.fss_account_transfer_delete(p_transfer_id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fss_account_transfer_delete TO anon, authenticated, service_role;

COMMIT;

