const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://oscdtdlwdrwvjvteqcix.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zY2R0ZGx3ZHJ3dmp2dGVxY2l4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY0NzI5OTQsImV4cCI6MjA4MjA0ODk5NH0.tAg8lwZPq86jz-CZIZh7fw8PhmUSO7o_VNCcqV9sIso';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  db: {
    schema: 'fss'
  }
});

const norm = (s) => (s || '').toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();

async function run() {
  console.log('--- Starting direct Supabase outflow synchronization ---');

  // ==========================================
  // 1. fss_outflow_project_cost
  // ==========================================
  console.log('\n--- 1. Syncing fss_outflow_project_cost ---');
  const projectCostRows = [
    {
      category: 'Project costs',
      jan_26: null, feb_26: null, mar_26: null,
      apr_26: 280372.00, may_26: 219722.00, jun_26: 666822.00,
      jul_26: 375260.00, aug_26: 369748.00, sep_26: 437906.00,
      oct_26: 0.00, nov_26: 0.00, dec_26: 0.00,
      fy_to_date: 2349830.00,
      shares: 100.0
    },
    {
      category: 'Freelancers & Consultants',
      jan_26: null, feb_26: null, mar_26: null,
      apr_26: 0.00, may_26: 133650.00, jun_26: 19890.00,
      jul_26: 0.00, aug_26: 48660.00, sep_26: 70650.00,
      oct_26: 0.00, nov_26: 0.00, dec_26: 0.00,
      fy_to_date: 272850.00,
      shares: 11.6
    },
    {
      category: 'Prototyping & Materials',
      jan_26: null, feb_26: null, mar_26: null,
      apr_26: 215876.00, may_26: 0.00, jun_26: 107184.00,
      jul_26: 375260.00, aug_26: 0.00, sep_26: 236756.00,
      oct_26: 0.00, nov_26: 0.00, dec_26: 0.00,
      fy_to_date: 935076.00,
      shares: 39.8
    },
    {
      category: 'Vendor Services (Project)',
      jan_26: null, feb_26: null, mar_26: null,
      apr_26: 0.00, may_26: 86072.00, jun_26: 226780.00,
      jul_26: 0.00, aug_26: 153584.00, sep_26: 130500.00,
      oct_26: 0.00, nov_26: 0.00, dec_26: 0.00,
      fy_to_date: 596936.00,
      shares: 25.4
    },
    {
      category: 'Testing & Certification',
      jan_26: null, feb_26: null, mar_26: null,
      apr_26: 64496.00, may_26: 0.00, jun_26: 312968.00,
      jul_26: 0.00, aug_26: 167504.00, sep_26: 0.00,
      oct_26: 0.00, nov_26: 0.00, dec_26: 0.00,
      fy_to_date: 544968.00,
      shares: 23.2
    }
  ];

  const { data: pcExisting, error: pcSelErr } = await supabase.from('fss_outflow_project_cost').select('*');
  if (pcSelErr) {
    console.error('Error selecting fss_outflow_project_cost:', pcSelErr);
  } else {
    console.log('Existing project_cost count:', pcExisting?.length);
    for (const row of projectCostRows) {
      const match = (pcExisting || []).find(e => norm(e.category) === norm(row.category));
      if (match) {
        const { error: updErr } = await supabase.from('fss_outflow_project_cost').update(row).eq('category', match.category);
        if (updErr) console.error('Error updating project_cost row:', row.category, updErr);
        else console.log('Updated project_cost:', row.category);
      } else {
        const { error: insErr } = await supabase.from('fss_outflow_project_cost').insert(row);
        if (insErr) console.error('Error inserting project_cost row:', row.category, insErr);
        else console.log('Inserted project_cost:', row.category);
      }
    }
  }

  // ==========================================
  // 2. fss_outflow_tax_statutory
  // ==========================================
  console.log('\n--- 2. Syncing fss_outflow_tax_statutory ---');
  const taxStatutoryRows = [
    {
      category: 'Tax & statutory',
      jan_26: null, feb_26: null, mar_26: null,
      apr_26: 559255.00, may_26: 537414.00, jun_26: 913500.00,
      jul_26: 496688.00, aug_26: 583148.00, sep_26: 858600.00,
      oct_26: 0.00, nov_26: 0.00, dec_26: 0.00,
      fy_to_date: 3948605.00,
      shares: 100.0
    },
    {
      category: 'GST Paid to Govt',
      jan_26: null, feb_26: null, mar_26: null,
      apr_26: 430435.00, may_26: 391460.00, jun_26: 576546.00,
      jul_26: 337341.00, aug_26: 435558.00, sep_26: 381004.00,
      oct_26: 0.00, nov_26: 0.00, dec_26: 0.00,
      fy_to_date: 2552344.00,
      shares: 64.6
    },
    {
      category: 'TDS Deposited',
      jan_26: null, feb_26: null, mar_26: null,
      apr_26: 128820.00, may_26: 145954.00, jun_26: 161954.00,
      jul_26: 159347.00, aug_26: 147590.00, sep_26: 152596.00,
      oct_26: 0.00, nov_26: 0.00, dec_26: 0.00,
      fy_to_date: 896261.00,
      shares: 22.7
    },
    {
      category: 'Advance Tax',
      jan_26: null, feb_26: null, mar_26: null,
      apr_26: 0.00, may_26: 0.00, jun_26: 175000.00,
      jul_26: 0.00, aug_26: 0.00, sep_26: 325000.00,
      oct_26: 0.00, nov_26: 0.00, dec_26: 0.00,
      fy_to_date: 500000.00,
      shares: 12.7
    }
  ];

  const { data: taxExisting, error: taxSelErr } = await supabase.from('fss_outflow_tax_statutory').select('*');
  if (taxSelErr) {
    console.error('Error selecting fss_outflow_tax_statutory:', taxSelErr);
  } else {
    console.log('Existing tax_statutory count:', taxExisting?.length);
    for (const row of taxStatutoryRows) {
      const match = (taxExisting || []).find(e => norm(e.category) === norm(row.category));
      if (match) {
        const { error: updErr } = await supabase.from('fss_outflow_tax_statutory').update(row).eq('category', match.category);
        if (updErr) console.error('Error updating tax_statutory row:', row.category, updErr);
        else console.log('Updated tax_statutory:', row.category);
      } else {
        const { error: insErr } = await supabase.from('fss_outflow_tax_statutory').insert(row);
        if (insErr) console.error('Error inserting tax_statutory row:', row.category, insErr);
        else console.log('Inserted tax_statutory:', row.category);
      }
    }
  }

  // ==========================================
  // 3. fss_outflow_oc_office_fixed
  // ==========================================
  console.log('\n--- 3. Syncing fss_outflow_oc_office_fixed ---');
  const officeFixedRows = [
    {
      expense_name: 'Office Fixed Total',
      jan26: null, feb26: null, mar26: null,
      apr26: 370659.00, may26: 365059.00, jun26: 373459.00,
      july26: 347059.00, aug26: 341259.00, sept26: 317959.00,
      oct26: 98417.00, nov26: 0.00, dec26: 0.00,
      fy_to_date: 2213871.00,
      share: 100.0
    },
    {
      expense_name: 'Office Rent',
      jan26: null, feb26: null, mar26: null,
      apr26: 199800.00, may26: 199800.00, jun26: 199800.00,
      july26: 199800.00, aug26: 199800.00, sept26: 199800.00,
      oct26: 118.00, nov26: 0.00, dec26: 0.00,
      fy_to_date: 1198918.00,
      share: 54.2
    },
    {
      expense_name: 'Electricity',
      jan26: null, feb26: null, mar26: null,
      apr26: 73000.00, may26: 70200.00, jun26: 75800.00,
      july26: 52200.00, aug26: 46400.00, sept26: 23100.00,
      oct26: 27500.00, nov26: 0.00, dec26: 0.00,
      fy_to_date: 368200.00,
      share: 16.6
    },
    {
      expense_name: 'Internet & Phone',
      jan26: null, feb26: null, mar26: null,
      apr26: 7079.00, may26: 7079.00, jun26: 7079.00,
      july26: 7079.00, aug26: 7079.00, sept26: 7079.00,
      oct26: 7079.00, nov26: 0.00, dec26: 0.00,
      fy_to_date: 49553.00,
      share: 2.2
    },
    {
      expense_name: 'Software Subscriptions',
      jan26: null, feb26: null, mar26: null,
      apr26: 63720.00, may26: 63720.00, jun26: 63720.00,
      july26: 63720.00, aug26: 63720.00, sept26: 63720.00,
      oct26: 63720.00, nov26: 0.00, dec26: 0.00,
      fy_to_date: 446040.00,
      share: 20.1
    },
    {
      expense_name: 'Housekeeping & Security',
      jan26: null, feb26: null, mar26: null,
      apr26: 21460.00, may26: 21460.00, jun26: 21460.00,
      july26: 21460.00, aug26: 21460.00, sept26: 21460.00,
      oct26: 0.00, nov26: 0.00, dec26: 0.00,
      fy_to_date: 128760.00,
      share: 5.8
    },
    {
      expense_name: 'Professional Tax',
      jan26: null, feb26: null, mar26: null,
      apr26: 5600.00, may26: 2800.00, jun26: 5600.00,
      july26: 2800.00, aug26: 2800.00, sept26: 2800.00,
      oct26: 0.00, nov26: 0.00, dec26: 0.00,
      fy_to_date: 22400.00,
      share: 1.0
    }
  ];

  const { data: ofExisting, error: ofSelErr } = await supabase.from('fss_outflow_oc_office_fixed').select('*');
  if (ofSelErr) {
    console.error('Error selecting fss_outflow_oc_office_fixed:', ofSelErr);
  } else {
    console.log('Existing office_fixed count:', ofExisting?.length);
    for (const row of officeFixedRows) {
      const match = (ofExisting || []).find(e => {
        const en = norm(e.expense_name || e.category || '');
        const rn = norm(row.expense_name);
        return en === rn || (rn.includes('total') && (en.includes('total') || en === 'office fixed'));
      });
      if (match) {
        const { error: updErr } = await supabase.from('fss_outflow_oc_office_fixed').update(row).eq('id', match.id);
        if (updErr) console.error('Error updating office_fixed row:', row.expense_name, updErr);
        else console.log('Updated office_fixed:', row.expense_name);
      } else {
        const { error: insErr } = await supabase.from('fss_outflow_oc_office_fixed').insert(row);
        if (insErr) console.error('Error inserting office_fixed row:', row.expense_name, insErr);
        else console.log('Inserted office_fixed:', row.expense_name);
      }
    }
  }

  // ==========================================
  // 4. fss_outflow_oc_travel
  // ==========================================
  console.log('\n--- 4. Syncing fss_outflow_oc_travel ---');
  const travelRows = [
    {
      category: 'Travel Total',
      jan26: null, feb26: null, mar26: null,
      apr26: 75750.00, may26: 114060.00, jun26: 147490.00,
      july26: 91240.00, aug26: 73660.00, sept26: 58995.00,
      oct26: 0.00, nov26: 0.00, dec26: 0.00,
      fy_to_date: 561195.00,
      share: 100.0
    },
    {
      category: 'Travel & Conveyance',
      jan26: null, feb26: null, mar26: null,
      apr26: 70350.00, may26: 89460.00, jun26: 127890.00,
      july26: 84840.00, aug26: 68460.00, sept26: 52395.00,
      oct26: 0.00, nov26: 0.00, dec26: 0.00,
      fy_to_date: 493395.00,
      share: 87.9
    },
    {
      category: 'Employee Reimbursements',
      jan26: null, feb26: null, mar26: null,
      apr26: 5400.00, may26: 24600.00, jun26: 19600.00,
      july26: 6400.00, aug26: 5200.00, sept26: 6600.00,
      oct26: 0.00, nov26: 0.00, dec26: 0.00,
      fy_to_date: 67800.00,
      share: 12.1
    }
  ];

  const { data: trvExisting, error: trvSelErr } = await supabase.from('fss_outflow_oc_travel').select('*');
  if (trvSelErr) {
    console.error('Error selecting fss_outflow_oc_travel:', trvSelErr);
  } else {
    console.log('Existing travel count:', trvExisting?.length);
    for (const row of travelRows) {
      const match = (trvExisting || []).find(e => {
        const en = norm(e.category || '');
        const rn = norm(row.category);
        return en === rn || (rn.includes('total') && (en.includes('total') || en === 'travel'));
      });
      if (match) {
        const { error: updErr } = await supabase.from('fss_outflow_oc_travel').update(row).eq('id', match.id);
        if (updErr) console.error('Error updating travel row:', row.category, updErr);
        else console.log('Updated travel:', row.category);
      } else {
        const { error: insErr } = await supabase.from('fss_outflow_oc_travel').insert(row);
        if (insErr) console.error('Error inserting travel row:', row.category, insErr);
        else console.log('Inserted travel:', row.category);
      }
    }
  }

  // ==========================================
  // 5. fss_outflow_oc_professional_admin
  // ==========================================
  console.log('\n--- 5. Syncing fss_outflow_oc_professional_admin ---');
  const profAdminRows = [
    {
      category: 'Professional & Admin Total',
      jan26: null, feb26: null, mar26: null,
      apr26: 65688.00, may26: 49308.00, jun26: 362571.00,
      july26: 932.00, aug26: 198216.00, sept26: 49544.00,
      oct26: 708.00, nov26: 0.00, dec26: 0.00,
      fy_to_date: 726967.00,
      share: 100.0
    },
    {
      category: 'CA, Audit & Accounting',
      jan26: null, feb26: null, mar26: null,
      apr26: 64496.00, may26: 0.00, jun26: 361568.00,
      july26: 0.00, aug26: 167504.00, sept26: 48600.00,
      oct26: 354.00, nov26: 0.00, dec26: 0.00,
      fy_to_date: 642522.00,
      share: 88.4
    },
    {
      category: 'Legal & Compliance',
      jan26: null, feb26: null, mar26: null,
      apr26: 0.00, may26: 48600.00, jun26: 0.00,
      july26: 0.00, aug26: 30240.00, sept26: 0.00,
      oct26: 354.00, nov26: 0.00, dec26: 0.00,
      fy_to_date: 79194.00,
      share: 10.9
    },
    {
      category: 'Bank Charges',
      jan26: null, feb26: null, mar26: null,
      apr26: 1192.00, may26: 708.00, jun26: 1003.00,
      july26: 932.00, aug26: 472.00, sept26: 944.00,
      oct26: 0.00, nov26: 0.00, dec26: 0.00,
      fy_to_date: 5251.00,
      share: 0.7
    }
  ];

  const { data: paExisting, error: paSelErr } = await supabase.from('fss_outflow_oc_professional_admin').select('*');
  if (paSelErr) {
    console.error('Error selecting fss_outflow_oc_professional_admin:', paSelErr);
  } else {
    console.log('Existing professional_admin count:', paExisting?.length);
    for (const row of profAdminRows) {
      const match = (paExisting || []).find(e => {
        const en = norm(e.category || '');
        const rn = norm(row.category);
        return en === rn || (rn.includes('total') && (en.includes('total') || en === 'professional & admin'));
      });
      if (match) {
        const { error: updErr } = await supabase.from('fss_outflow_oc_professional_admin').update(row).eq('id', match.id);
        if (updErr) console.error('Error updating professional_admin row:', row.category, updErr);
        else console.log('Updated professional_admin:', row.category);
      } else {
        const { error: insErr } = await supabase.from('fss_outflow_oc_professional_admin').insert(row);
        if (insErr) console.error('Error inserting professional_admin row:', row.category, insErr);
        else console.log('Inserted professional_admin:', row.category);
      }
    }
  }

  console.log('\n--- Direct sync completed successfully ---');
}

run().catch(err => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});

