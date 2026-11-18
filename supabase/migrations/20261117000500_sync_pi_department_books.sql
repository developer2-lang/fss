BEGIN;

GRANT USAGE ON SCHEMA fss TO anon, authenticated, service_role;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'pi_engineering',
    'pi_design',
    'pi_operations_admin',
    'pi_finance',
    'pi_hr',
    'pi_sales_bd'
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

  GRANT ALL ON TABLE
    fss.pi_engineering,
    fss.pi_design,
    fss.pi_operations_admin,
    fss.pi_finance,
    fss.pi_hr,
    fss.pi_sales_bd
  TO service_role;
END;
$$;

ALTER TABLE fss.proforma_invoices
  ADD COLUMN IF NOT EXISTS tax_invoice_date DATE;

CREATE OR REPLACE FUNCTION fss.rebuild_pi_department_books()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, fss
AS $$
DECLARE
  current_year_start DATE := make_date(EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER, 1, 1);
  pi_book RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('fss.pi_department_books.refresh', 0));

  FOR pi_book IN
    SELECT mapping.department_name, mapping.table_name
    FROM (VALUES
      ('Engineering', 'pi_engineering'),
      ('Design', 'pi_design'),
      ('Operations / Admin', 'pi_operations_admin'),
      ('Finance', 'pi_finance'),
      ('HR', 'pi_hr'),
      ('Sales & BD', 'pi_sales_bd')
    ) AS mapping(department_name, table_name)
  LOOP
    EXECUTE format('DELETE FROM fss.%I WHERE TRUE', pi_book.table_name);
    EXECUTE format($query$
      INSERT INTO fss.%I (
        client_name,
        jan, feb, mar, apr, may, jun, jul, aug, sep, oct, nov, dec
      )
      SELECT
        COALESCE(NULLIF(BTRIM(po.client_name), ''), 'Client'),
        COALESCE(SUM(pi.pre_gst_amount * department.amount / NULLIF(order_split.total_amount, 0))
          FILTER (WHERE EXTRACT(MONTH FROM pi.pi_date) = 1), 0),
        COALESCE(SUM(pi.pre_gst_amount * department.amount / NULLIF(order_split.total_amount, 0))
          FILTER (WHERE EXTRACT(MONTH FROM pi.pi_date) = 2), 0),
        COALESCE(SUM(pi.pre_gst_amount * department.amount / NULLIF(order_split.total_amount, 0))
          FILTER (WHERE EXTRACT(MONTH FROM pi.pi_date) = 3), 0),
        COALESCE(SUM(pi.pre_gst_amount * department.amount / NULLIF(order_split.total_amount, 0))
          FILTER (WHERE EXTRACT(MONTH FROM pi.pi_date) = 4), 0),
        COALESCE(SUM(pi.pre_gst_amount * department.amount / NULLIF(order_split.total_amount, 0))
          FILTER (WHERE EXTRACT(MONTH FROM pi.pi_date) = 5), 0),
        COALESCE(SUM(pi.pre_gst_amount * department.amount / NULLIF(order_split.total_amount, 0))
          FILTER (WHERE EXTRACT(MONTH FROM pi.pi_date) = 6), 0),
        COALESCE(SUM(pi.pre_gst_amount * department.amount / NULLIF(order_split.total_amount, 0))
          FILTER (WHERE EXTRACT(MONTH FROM pi.pi_date) = 7), 0),
        COALESCE(SUM(pi.pre_gst_amount * department.amount / NULLIF(order_split.total_amount, 0))
          FILTER (WHERE EXTRACT(MONTH FROM pi.pi_date) = 8), 0),
        COALESCE(SUM(pi.pre_gst_amount * department.amount / NULLIF(order_split.total_amount, 0))
          FILTER (WHERE EXTRACT(MONTH FROM pi.pi_date) = 9), 0),
        COALESCE(SUM(pi.pre_gst_amount * department.amount / NULLIF(order_split.total_amount, 0))
          FILTER (WHERE EXTRACT(MONTH FROM pi.pi_date) = 10), 0),
        COALESCE(SUM(pi.pre_gst_amount * department.amount / NULLIF(order_split.total_amount, 0))
          FILTER (WHERE EXTRACT(MONTH FROM pi.pi_date) = 11), 0),
        COALESCE(SUM(pi.pre_gst_amount * department.amount / NULLIF(order_split.total_amount, 0))
          FILTER (WHERE EXTRACT(MONTH FROM pi.pi_date) = 12), 0)
      FROM fss.proforma_invoices AS pi
      JOIN fss.fss_table_order_po AS po
        ON po.id = COALESCE(pi.order_po_id, pi.order_id)
      JOIN (
        SELECT order_po_id, department_name, SUM(amount) AS amount
        FROM fss.fss_table_order_departments
        GROUP BY order_po_id, department_name
      ) AS department
        ON department.order_po_id = po.id
      JOIN (
        SELECT order_po_id, SUM(amount) AS total_amount
        FROM fss.fss_table_order_departments
        GROUP BY order_po_id
      ) AS order_split
        ON order_split.order_po_id = po.id
      WHERE LOWER(BTRIM(department.department_name)) = LOWER($1)
        AND pi.pi_date >= $2
        AND pi.pi_date < ($2 + INTERVAL '1 year')
        AND LOWER(COALESCE(BTRIM(pi.status), 'issued'))
          NOT IN ('cancelled', 'canceled', 'deleted', 'void')
      GROUP BY COALESCE(NULLIF(BTRIM(po.client_name), ''), 'Client')
    $query$, pi_book.table_name)
    USING pi_book.department_name, current_year_start;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION fss.refresh_pi_department_books_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, fss
AS $$
BEGIN
  PERFORM fss.rebuild_pi_department_books();
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION fss.rebuild_pi_department_books() FROM PUBLIC;
REVOKE ALL ON FUNCTION fss.refresh_pi_department_books_trigger() FROM PUBLIC;

DROP TRIGGER IF EXISTS refresh_pi_books_from_proforma_invoices
  ON fss.proforma_invoices;
CREATE TRIGGER refresh_pi_books_from_proforma_invoices
AFTER INSERT OR UPDATE OR DELETE ON fss.proforma_invoices
FOR EACH STATEMENT
EXECUTE FUNCTION fss.refresh_pi_department_books_trigger();

DROP TRIGGER IF EXISTS refresh_pi_books_from_orders
  ON fss.fss_table_order_po;
CREATE TRIGGER refresh_pi_books_from_orders
AFTER INSERT OR UPDATE OR DELETE ON fss.fss_table_order_po
FOR EACH STATEMENT
EXECUTE FUNCTION fss.refresh_pi_department_books_trigger();

DROP TRIGGER IF EXISTS refresh_pi_books_from_order_departments
  ON fss.fss_table_order_departments;
CREATE TRIGGER refresh_pi_books_from_order_departments
AFTER INSERT OR UPDATE OR DELETE ON fss.fss_table_order_departments
FOR EACH STATEMENT
EXECUTE FUNCTION fss.refresh_pi_department_books_trigger();

SELECT fss.rebuild_pi_department_books();

COMMIT;
