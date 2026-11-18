CREATE TABLE IF NOT EXISTS public.fss_outflow_oc_travel (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    category varchar(150) NOT NULL,
    jan26 numeric(15,2),
    feb26 numeric(15,2),
    mar26 numeric(15,2),
    apr26 numeric(15,2),
    may26 numeric(15,2),
    jun26 numeric(15,2),
    july26 numeric(15,2),
    aug26 numeric(15,2),
    sept26 numeric(15,2),
    oct26 numeric(15,2),
    nov26 numeric(15,2),
    dec26 numeric(15,2),
    fy_to_date numeric(15,2),
    share numeric(10,2),
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.fss_outflow_oc_travel ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all actions on fss_outflow_oc_travel" ON public.fss_outflow_oc_travel FOR ALL USING (true) WITH CHECK (true);
