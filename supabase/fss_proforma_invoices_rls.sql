-- ==============================================================================
-- FSS Schema: Proforma Invoices RLS Policies and Permissions
-- Run this in the Supabase SQL Editor to enable SELECT, INSERT, UPDATE, DELETE
-- ==============================================================================

-- 1. Ensure schema usage and table grants for anon, authenticated, service_role
GRANT USAGE ON SCHEMA fss TO anon, authenticated, service_role;
GRANT ALL ON TABLE fss.proforma_invoices TO anon, authenticated, service_role;
GRANT ALL ON TABLE fss.proforma_invoice_attachments TO anon, authenticated, service_role;
GRANT ALL ON TABLE fss.proforma_invoice_emails TO anon, authenticated, service_role;
GRANT ALL ON TABLE fss.proforma_invoice_recipients TO anon, authenticated, service_role;

-- 2. Allow all CRUD operations on fss.proforma_invoices
ALTER TABLE fss.proforma_invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on proforma_invoices" ON fss.proforma_invoices;
CREATE POLICY "Allow all on proforma_invoices" 
  ON fss.proforma_invoices 
  FOR ALL 
  TO anon, authenticated, service_role 
  USING (true) 
  WITH CHECK (true);

-- 3. Allow all CRUD operations on fss.proforma_invoice_attachments
ALTER TABLE fss.proforma_invoice_attachments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on proforma_invoice_attachments" ON fss.proforma_invoice_attachments;
CREATE POLICY "Allow all on proforma_invoice_attachments" 
  ON fss.proforma_invoice_attachments 
  FOR ALL 
  TO anon, authenticated, service_role 
  USING (true) 
  WITH CHECK (true);

-- 4. Allow all CRUD operations on fss.proforma_invoice_emails
ALTER TABLE fss.proforma_invoice_emails ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on proforma_invoice_emails" ON fss.proforma_invoice_emails;
CREATE POLICY "Allow all on proforma_invoice_emails" 
  ON fss.proforma_invoice_emails 
  FOR ALL 
  TO anon, authenticated, service_role 
  USING (true) 
  WITH CHECK (true);

-- 5. Allow all CRUD operations on fss.proforma_invoice_recipients
ALTER TABLE fss.proforma_invoice_recipients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on proforma_invoice_recipients" ON fss.proforma_invoice_recipients;
CREATE POLICY "Allow all on proforma_invoice_recipients" 
  ON fss.proforma_invoice_recipients 
  FOR ALL 
  TO anon, authenticated, service_role 
  USING (true) 
  WITH CHECK (true);

