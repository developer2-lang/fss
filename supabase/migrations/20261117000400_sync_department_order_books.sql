BEGIN;

GRANT USAGE ON SCHEMA fss TO anon, authenticated, service_role;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'order_book_design',
    'order_book_operations_admin',
    'order_book_hr',
    'order_book_sales_bd',
    'order_book_finance'
  ]
  LOOP
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS fss.%I (LIKE fss.order_book_engineering INCLUDING ALL)',
      table_name
    );
    EXECUTE format('ALTER TABLE fss.%I DISABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('GRANT SELECT ON TABLE fss.%I TO anon, authenticated, service_role', table_name);
    EXECUTE format(
      'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE fss.%I FROM anon, authenticated',
      table_name
    );
  END LOOP;

  ALTER TABLE fss.order_book_engineering DISABLE ROW LEVEL SECURITY;
  GRANT SELECT ON TABLE fss.order_book_engineering TO anon, authenticated, service_role;
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE fss.order_book_engineering FROM anon, authenticated;
  GRANT ALL ON TABLE
    fss.order_book_design,
    fss.order_book_engineering,
    fss.order_book_operations_admin,
    fss.order_book_hr,
    fss.order_book_sales_bd,
    fss.order_book_finance
  TO service_role;
END;
$$;

CREATE OR REPLACE FUNCTION fss.rebuild_order_book_departments()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, fss
AS $$
DECLARE
  current_year_start DATE := make_date(EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER, 1, 1);
  department_book RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('fss.order_book_departments.refresh', 0));

  FOR department_book IN
    SELECT mapping.department_name, mapping.table_name
    FROM (VALUES
      ('Design', 'order_book_design'),
      ('Engineering', 'order_book_engineering'),
      ('Operations / Admin', 'order_book_operations_admin'),
      ('HR', 'order_book_hr'),
      ('Sales & BD', 'order_book_sales_bd'),
      ('Finance', 'order_book_finance')
    ) AS mapping(department_name, table_name)
  LOOP
    EXECUTE format('DELETE FROM fss.%I WHERE TRUE', department_book.table_name);
    EXECUTE format($query$
      INSERT INTO fss.%I (
        client_name,
        jan, feb, mar, apr, may, jun, jul, aug, sep, oct, nov, dec
      )
      SELECT
        COALESCE(NULLIF(BTRIM(po.client_name), ''), 'Client'),
        COALESCE(SUM(department.amount) FILTER (WHERE EXTRACT(MONTH FROM po.order_date) = 1), 0),
        COALESCE(SUM(department.amount) FILTER (WHERE EXTRACT(MONTH FROM po.order_date) = 2), 0),
        COALESCE(SUM(department.amount) FILTER (WHERE EXTRACT(MONTH FROM po.order_date) = 3), 0),
        COALESCE(SUM(department.amount) FILTER (WHERE EXTRACT(MONTH FROM po.order_date) = 4), 0),
        COALESCE(SUM(department.amount) FILTER (WHERE EXTRACT(MONTH FROM po.order_date) = 5), 0),
        COALESCE(SUM(department.amount) FILTER (WHERE EXTRACT(MONTH FROM po.order_date) = 6), 0),
        COALESCE(SUM(department.amount) FILTER (WHERE EXTRACT(MONTH FROM po.order_date) = 7), 0),
        COALESCE(SUM(department.amount) FILTER (WHERE EXTRACT(MONTH FROM po.order_date) = 8), 0),
        COALESCE(SUM(department.amount) FILTER (WHERE EXTRACT(MONTH FROM po.order_date) = 9), 0),
        COALESCE(SUM(department.amount) FILTER (WHERE EXTRACT(MONTH FROM po.order_date) = 10), 0),
        COALESCE(SUM(department.amount) FILTER (WHERE EXTRACT(MONTH FROM po.order_date) = 11), 0),
        COALESCE(SUM(department.amount) FILTER (WHERE EXTRACT(MONTH FROM po.order_date) = 12), 0)
      FROM fss.fss_table_order_po AS po
      JOIN fss.fss_table_order_departments AS department
        ON department.order_po_id = po.id
      WHERE LOWER(BTRIM(department.department_name)) = LOWER($1)
        AND po.order_date >= $2
        AND po.order_date < ($2 + INTERVAL '1 year')
      GROUP BY COALESCE(NULLIF(BTRIM(po.client_name), ''), 'Client')
    $query$, department_book.table_name)
    USING department_book.department_name, current_year_start;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION fss.rebuild_order_book_engineering()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, fss
AS $$
BEGIN
  PERFORM fss.rebuild_order_book_departments();
END;
$$;

CREATE OR REPLACE FUNCTION fss.refresh_order_book_engineering_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, fss
AS $$
BEGIN
  PERFORM fss.rebuild_order_book_departments();
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION fss.rebuild_order_book_departments() FROM PUBLIC;
REVOKE ALL ON FUNCTION fss.rebuild_order_book_engineering() FROM PUBLIC;
REVOKE ALL ON FUNCTION fss.refresh_order_book_engineering_trigger() FROM PUBLIC;

SELECT fss.rebuild_order_book_departments();

COMMIT;
