BEGIN;

CREATE TABLE IF NOT EXISTS fss.order_book_engineering (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name TEXT,
  jan NUMERIC(15, 2) DEFAULT 0,
  feb NUMERIC(15, 2) DEFAULT 0,
  mar NUMERIC(15, 2) DEFAULT 0,
  apr NUMERIC(15, 2) DEFAULT 0,
  may NUMERIC(15, 2) DEFAULT 0,
  jun NUMERIC(15, 2) DEFAULT 0,
  jul NUMERIC(15, 2) DEFAULT 0,
  aug NUMERIC(15, 2) DEFAULT 0,
  sep NUMERIC(15, 2) DEFAULT 0,
  oct NUMERIC(15, 2) DEFAULT 0,
  nov NUMERIC(15, 2) DEFAULT 0,
  dec NUMERIC(15, 2) DEFAULT 0,
  fy_to_date NUMERIC(15, 2) GENERATED ALWAYS AS (
    COALESCE(jan, 0) +
    COALESCE(feb, 0) +
    COALESCE(mar, 0) +
    COALESCE(apr, 0) +
    COALESCE(may, 0) +
    COALESCE(jun, 0) +
    COALESCE(jul, 0) +
    COALESCE(aug, 0) +
    COALESCE(sep, 0) +
    COALESCE(oct, 0) +
    COALESCE(nov, 0) +
    COALESCE(dec, 0)
  ) STORED,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION fss.rebuild_order_book_engineering()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, fss
AS $$
DECLARE
  current_year_start DATE := make_date(EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER, 1, 1);
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('fss.order_book_engineering.refresh', 0));

  DELETE FROM fss.order_book_engineering WHERE TRUE;

  INSERT INTO fss.order_book_engineering (
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
  WHERE LOWER(BTRIM(department.department_name)) = 'engineering'
    AND po.order_date >= current_year_start
    AND po.order_date < (current_year_start + INTERVAL '1 year')
  GROUP BY COALESCE(NULLIF(BTRIM(po.client_name), ''), 'Client');
END;
$$;

CREATE OR REPLACE FUNCTION fss.refresh_order_book_engineering_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, fss
AS $$
BEGIN
  PERFORM fss.rebuild_order_book_engineering();
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION fss.rebuild_order_book_engineering() FROM PUBLIC;
REVOKE ALL ON FUNCTION fss.refresh_order_book_engineering_trigger() FROM PUBLIC;

DROP TRIGGER IF EXISTS refresh_engineering_order_book_from_orders
  ON fss.fss_table_order_po;
CREATE TRIGGER refresh_engineering_order_book_from_orders
AFTER INSERT OR UPDATE OR DELETE ON fss.fss_table_order_po
FOR EACH STATEMENT
EXECUTE FUNCTION fss.refresh_order_book_engineering_trigger();

DROP TRIGGER IF EXISTS refresh_engineering_order_book_from_departments
  ON fss.fss_table_order_departments;
CREATE TRIGGER refresh_engineering_order_book_from_departments
AFTER INSERT OR UPDATE OR DELETE ON fss.fss_table_order_departments
FOR EACH STATEMENT
EXECUTE FUNCTION fss.refresh_order_book_engineering_trigger();

SELECT fss.rebuild_order_book_engineering();

COMMIT;
