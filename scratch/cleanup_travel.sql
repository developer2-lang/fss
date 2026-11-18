DELETE FROM public.fss_outflow_oc_travel
WHERE id NOT IN (
  SELECT MIN(id) FROM public.fss_outflow_oc_travel GROUP BY category
);
