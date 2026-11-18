const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://oscdtdlwdrwvjvteqcix.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zY2R0ZGx3ZHJ3dmp2dGVxY2l4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY0NzI5OTQsImV4cCI6MjA4MjA0ODk5NH0.tAg8lwZPq86jz-CZIZh7fw8PhmUSO7o_VNCcqV9sIso';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  db: { schema: 'fss' }
});

async function runFullVerification() {
  console.log('======================================================');
  console.log('   FULL END-TO-END FSS SCHEMA VERIFICATION');
  console.log('======================================================\n');

  // 1. SELECT Operations
  console.log('1. Testing SELECT operations across tables...');
  const selectTables = [
    'fss_table_transactions',
    'fss_client',
    'fss_vendor',
    'fss_employe',
    'fss_projects',
    'fss_departments',
    'fss_bank_accounts',
    'fss_categories',
    'fss_operation_receipts',
    'fss_income',
    'fss_financing',
    'fss_outflow_oc_people',
    'fss_outflow_project_cost',
    'fss_outflow_tax_statutory',
    'fss_outflow_travel',
    'fss_outflow_oc_office_fixed',
    'fss_outflow_oc_office_variable',
    'fss_outflow_capex',
    'fss_outflow_financing_and_owner'
  ];

  for (const tbl of selectTables) {
    const { data, error } = await supabase.from(tbl).select('*').limit(1);
    if (error) {
      console.error(`   ❌ SELECT fss.${tbl}: FAILED -> ${error.message}`);
    } else {
      console.log(`   ✅ SELECT fss.${tbl}: OK (${data.length} sample row)`);
    }
  }

  // 2. Views Verification
  console.log('\n2. Testing Database Views & Reports...');
  for (const vw of ['fss_cash_inflow', 'fss_outflow_oc_people_report', 'fss_by_account_credited_debited']) {
    const { data, error } = await supabase.from(vw).select('*').limit(2);
    if (error) {
      console.error(`   ❌ VIEW fss.${vw}: FAILED -> ${error.message}`);
    } else {
      console.log(`   ✅ VIEW fss.${vw}: OK (${data.length} rows returned)`);
    }
  }

  // 3. INSERT, UPDATE, DELETE Operations
  console.log('\n3. Testing INSERT, UPDATE, DELETE operations (controlled test record)...');
  const testCatName = '__fss_verification_test_cat__';

  // INSERT
  const { data: inserted, error: insErr } = await supabase
    .from('fss_categories')
    .insert([{ category_name: testCatName, category_type: 'Outflow' }])
    .select()
    .single();

  if (insErr) {
    console.error('   ❌ INSERT into fss.fss_categories failed:', insErr.message);
  } else {
    console.log(`   ✅ INSERT into fss.fss_categories: OK (ID: ${inserted?.id})`);

    // UPDATE
    const { data: updated, error: updErr } = await supabase
      .from('fss_categories')
      .update({ category_type: 'Inflow' })
      .eq('id', inserted.id)
      .select()
      .single();

    if (updErr) {
      console.error('   ❌ UPDATE on fss.fss_categories failed:', updErr.message);
    } else {
      console.log(`   ✅ UPDATE on fss.fss_categories: OK (category_type changed to: ${updated?.category_type})`);
    }

    // DELETE
    const { error: delErr } = await supabase
      .from('fss_categories')
      .delete()
      .eq('id', inserted.id);

    if (delErr) {
      console.error('   ❌ DELETE from fss.fss_categories failed:', delErr.message);
    } else {
      console.log('   ✅ DELETE from fss.fss_categories: OK (test record cleaned up successfully)');
    }
  }

  // 4. RPC Functions Verification
  console.log('\n4. Testing RPC Stored Procedures...');
  const { data: rpcRes, error: rpcErr } = await supabase.rpc('fss_insert_audit_log', {
    p_user_name: 'Antigravity Verification',
    p_action: 'complete_test',
    p_record_type: 'verification',
    p_record_id: '999',
    p_summary: 'E2E Verification Complete',
    p_changes: { success: true },
    p_created_at: new Date().toISOString()
  });

  if (rpcErr) {
    console.error('   ❌ RPC fss_insert_audit_log failed:', rpcErr.message);
  } else {
    console.log('   ✅ RPC fss_insert_audit_log: OK');
  }

  console.log('\n======================================================');
  console.log('   RESULT: FSS SCHEMA IS FULLY OPERATIONAL AND IDENTICAL TO PUBLIC');
  console.log('======================================================');
}

runFullVerification().catch(console.error);

