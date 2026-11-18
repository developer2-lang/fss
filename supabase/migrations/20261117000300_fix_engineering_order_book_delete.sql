BEGIN;

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

SELECT fss.rebuild_order_book_engineering();

COMMIT;
