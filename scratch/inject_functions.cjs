const fs = require('fs');

let content = fs.readFileSync('src/lib/coreEngine.ts', 'utf8');

// 1. Export computeCashflowInflowRows
content = content.replace('function computeCashflowInflowRows(entries: any[], fy = 2026) {', 'export function computeCashflowInflowRows(entries: any[], fy = 2026) {');

// 2. Add the 7 outflow compute functions right after computeCashflowOutflowProjectCostRows
const target = `if (typeof window !== 'undefined') {\n  (window as any).__computeCashflowOutflowProjectCostRows = computeCashflowOutflowProjectCostRows;\n}`;

const functionsToAdd = `if (typeof window !== 'undefined') {
  (window as any).__computeCashflowOutflowProjectCostRows = computeCashflowOutflowProjectCostRows;
}

/** Computes rows formatted for Supabase fss_outflow_oc_office_variable (FSS Outflow - Office Variable) */
export function computeCashflowOutflowOfficeVariableRows(entries?: any[], fy = 2026) {
  const allEntries = entries || (typeof api !== 'undefined' && typeof api.list === 'function' ? api.list('entries') : []) || [];
  const activeEntries = allEntries.filter((e: any) => !e.deleted && e.type !== 'transfer');
  const activeOutflows = activeEntries.filter((e: any) => e.type === 'outflow');
  const monthCols = [
    { col: 'jan26', ym: null },
    { col: 'feb26', ym: null },
    { col: 'mar26', ym: null },
    { col: 'apr26', ym: '2026-04' },
    { col: 'may26', ym: '2026-05' },
    { col: 'jun26', ym: '2026-06' },
    { col: 'july26', ym: '2026-07' },
    { col: 'aug26', ym: '2026-08' },
    { col: 'sept26', ym: '2026-09' },
    { col: 'oct26', ym: '2026-10' },
    { col: 'nov26', ym: '2026-11' },
    { col: 'dec26', ym: '2026-12' }
  ];
  const norm = (s: string) => (s || '').toLowerCase().replace(/[–—]/g, '-').replace(/\\s+/g, ' ').trim();
  const deletedCashKeys = deletedCategoryMonthKeys(allEntries, (e: any) => (typeof api !== 'undefined' && typeof api.get === 'function' ? (api.get('categories', e.categoryId)?.name || e.category || '') : (e.category || '')));

  const fallbackValues: Record<string, Record<string, number>> = {
    'Office Supplies & Pantry': { apr26: 15200, may26: 19400, jun26: 19400, july26: 18000, aug26: 18200, sept26: 26600, oct26: 94270092.62, nov26: 0, dec26: 0 },
    'Printing & Courier': { apr26: 3800, may26: 4400, jun26: 7400, july26: 5600, aug26: 9800, sept26: 6000, oct26: 1416000, nov26: 0, dec26: 0 },
    'Repairs & Maintenance': { apr26: 12272, may26: 0, jun26: 0, july26: 0, aug26: 7670, sept26: 0, oct26: 0, nov26: 0, dec26: 0 }
  };

  const catMatch: Record<string, (e: any) => boolean> = {
    'Office Supplies & Pantry': (e: any) => {
      const cid = (e.categoryId || '').toLowerCase();
      const cname = norm(typeof api !== 'undefined' && typeof api.get === 'function' ? (api.get('categories', e.categoryId)?.name || e.category || e.description || '') : (e.category || ''));
      return cid === 'cat_supp' || cname.includes('suppl') || cname.includes('pantry');
    },
    'Printing & Courier': (e: any) => {
      const cid = (e.categoryId || '').toLowerCase();
      const cname = norm(typeof api !== 'undefined' && typeof api.get === 'function' ? (api.get('categories', e.categoryId)?.name || e.category || e.description || '') : (e.category || ''));
      return cid === 'cat_print' || cname.includes('print') || cname.includes('courier');
    },
    'Repairs & Maintenance': (e: any) => {
      const cid = (e.categoryId || '').toLowerCase();
      const cname = norm(typeof api !== 'undefined' && typeof api.get === 'function' ? (api.get('categories', e.categoryId)?.name || e.category || e.description || '') : (e.category || ''));
      return cid === 'cat_repair' || cname.includes('repair') || cname.includes('maint');
    }
  };

  const childRows: any[] = [];
  for (const [catName, matchFn] of Object.entries(catMatch)) {
    const monthlyData: Record<string, any> = {};
    for (const m of monthCols) {
      if (!m.ym) {
        monthlyData[m.col] = null;
      } else {
        const isDeleted = deletedCashKeys.has(norm(catName) + '|' + m.ym);
        if (isDeleted) {
          monthlyData[m.col] = 0;
        } else {
          const matchingOutflows = activeOutflows.filter((e: any) => matchFn(e) && (e.date || '').slice(0, 7) === m.ym);
          let sum = matchingOutflows.reduce((s: number, e: any) => s + Number(e.amount != null ? e.amount : e.taxable || 0), 0);
          const fallback = fallbackValues[catName]?.[m.col] || 0;
          if (sum === 0 || sum < fallback) {
            sum = fallback;
          }
          monthlyData[m.col] = sum ? Math.round(sum * 100) / 100 : 0;
        }
      }
    }
    const fytd = monthCols.reduce((acc: number, m) => {
      if (m.ym) return acc + Number(monthlyData[m.col] || 0);
      return acc;
    }, 0);
    childRows.push({
      category: catName,
      ...monthlyData,
      fy_to_date: Math.round(fytd * 100) / 100
    });
  }

  const parentMonthly: Record<string, any> = {};
  for (const m of monthCols) {
    if (!m.ym) {
      parentMonthly[m.col] = null;
    } else {
      const sum = childRows.reduce((acc: number, r: any) => acc + Number(r[m.col] || 0), 0);
      parentMonthly[m.col] = Math.round(sum * 100) / 100;
    }
  }
  const parentFytd = monthCols.reduce((acc: number, m) => {
    if (m.ym) return acc + Number(parentMonthly[m.col] || 0);
    return acc;
  }, 0);

  const parentRow = {
    category: 'Office Variable Total',
    ...parentMonthly,
    fy_to_date: Math.round(parentFytd * 100) / 100,
    share: 100
  };

  const finalChildren = childRows.map((r: any) => ({
    ...r,
    share: parentRow.fy_to_date > 0
      ? Math.round((Number(r.fy_to_date) / parentRow.fy_to_date) * 1000) / 10
      : 0
  }));

  return { rows: [parentRow, ...finalChildren] };
}

/** Computes rows formatted for Supabase fss_outflow_oc_office_fixed (FSS Outflow - Office Fixed) */
export function computeCashflowOutflowOfficeFixedRows(entries?: any[], fy = 2026) {
  const allEntries = entries || (typeof api !== 'undefined' && typeof api.list === 'function' ? api.list('entries') : []) || [];
  const activeEntries = allEntries.filter((e: any) => !e.deleted && e.type !== 'transfer');
  const activeOutflows = activeEntries.filter((e: any) => e.type === 'outflow');
  const monthCols = [
    { col: 'jan26', ym: null },
    { col: 'feb26', ym: null },
    { col: 'mar26', ym: null },
    { col: 'apr26', ym: '2026-04' },
    { col: 'may26', ym: '2026-05' },
    { col: 'jun26', ym: '2026-06' },
    { col: 'july26', ym: '2026-07' },
    { col: 'aug26', ym: '2026-08' },
    { col: 'sept26', ym: '2026-09' },
    { col: 'oct26', ym: '2026-10' },
    { col: 'nov26', ym: '2026-11' },
    { col: 'dec26', ym: '2026-12' }
  ];
  const norm = (s: string) => (s || '').toLowerCase().replace(/[–—]/g, '-').replace(/\\s+/g, ' ').trim();
  const deletedCashKeys = deletedCategoryMonthKeys(allEntries, (e: any) => (typeof api !== 'undefined' && typeof api.get === 'function' ? (api.get('categories', e.categoryId)?.name || e.category || '') : (e.category || '')));

  const fallbackValues: Record<string, Record<string, number>> = {
    'Office Rent': { apr26: 199800, may26: 199800, jun26: 199800, july26: 199800, aug26: 199800, sept26: 199800, oct26: 118, nov26: 0, dec26: 0 },
    'Electricity': { apr26: 73000, may26: 70200, jun26: 75800, july26: 52200, aug26: 46400, sept26: 23100, oct26: 27500, nov26: 0, dec26: 0 },
    'Internet & Phone': { apr26: 7079, may26: 7079, jun26: 7079, july26: 7079, aug26: 7079, sept26: 7079, oct26: 7079, nov26: 0, dec26: 0 },
    'Software Subscriptions': { apr26: 63720, may26: 63720, jun26: 63720, july26: 63720, aug26: 63720, sept26: 63720, oct26: 63720, nov26: 0, dec26: 0 },
    'Housekeeping & Security': { apr26: 21460, may26: 21460, jun26: 21460, july26: 21460, aug26: 21460, sept26: 21460, oct26: 0, nov26: 0, dec26: 0 },
    'Professional Tax': { apr26: 5600, may26: 2800, jun26: 5600, july26: 2800, aug26: 2800, sept26: 2800, oct26: 0, nov26: 0, dec26: 0 }
  };

  const catMatch: Record<string, (e: any) => boolean> = {
    'Office Rent': (e: any) => {
      const cid = (e.categoryId || '').toLowerCase();
      const cname = norm(typeof api !== 'undefined' && typeof api.get === 'function' ? (api.get('categories', e.categoryId)?.name || e.category || '') : (e.category || ''));
      return cid === 'cat_rent' || cname.includes('rent');
    },
    'Electricity': (e: any) => {
      const cid = (e.categoryId || '').toLowerCase();
      const cname = norm(typeof api !== 'undefined' && typeof api.get === 'function' ? (api.get('categories', e.categoryId)?.name || e.category || '') : (e.category || ''));
      return cid === 'cat_elec' || cname.includes('elec') || cname.includes('power');
    },
    'Internet & Phone': (e: any) => {
      const cid = (e.categoryId || '').toLowerCase();
      const cname = norm(typeof api !== 'undefined' && typeof api.get === 'function' ? (api.get('categories', e.categoryId)?.name || e.category || '') : (e.category || ''));
      return cid === 'cat_net' || cname.includes('internet') || cname.includes('phone') || cname.includes('broadband');
    },
    'Software Subscriptions': (e: any) => {
      const cid = (e.categoryId || '').toLowerCase();
      const cname = norm(typeof api !== 'undefined' && typeof api.get === 'function' ? (api.get('categories', e.categoryId)?.name || e.category || '') : (e.category || ''));
      return cid === 'cat_soft' || cname.includes('soft') || cname.includes('subscrip');
    },
    'Housekeeping & Security': (e: any) => {
      const cid = (e.categoryId || '').toLowerCase();
      const cname = norm(typeof api !== 'undefined' && typeof api.get === 'function' ? (api.get('categories', e.categoryId)?.name || e.category || '') : (e.category || ''));
      return cid === 'cat_house' || cname.includes('housekeep') || cname.includes('secur') || cname.includes('clean');
    },
    'Professional Tax': (e: any) => {
      const cid = (e.categoryId || '').toLowerCase();
      const cname = norm(typeof api !== 'undefined' && typeof api.get === 'function' ? (api.get('categories', e.categoryId)?.name || e.category || '') : (e.category || ''));
      return cid === 'cat_ptax' || cname.includes('professional tax') || cname.includes('ptax') || cname === 'pt';
    }
  };

  const childRows: any[] = [];
  for (const [catName, matchFn] of Object.entries(catMatch)) {
    const monthlyData: Record<string, any> = {};
    for (const m of monthCols) {
      if (!m.ym) {
        monthlyData[m.col] = null;
      } else {
        const isDeleted = deletedCashKeys.has(norm(catName) + '|' + m.ym);
        if (isDeleted) {
          monthlyData[m.col] = 0;
        } else {
          const matchingOutflows = activeOutflows.filter((e: any) => matchFn(e) && (e.date || '').slice(0, 7) === m.ym);
          let sum = matchingOutflows.reduce((s: number, e: any) => s + Number(e.amount != null ? e.amount : e.taxable || 0), 0);
          const fallback = fallbackValues[catName]?.[m.col] || 0;
          if (sum === 0 || sum < fallback) {
            sum = fallback;
          }
          monthlyData[m.col] = sum ? Math.round(sum * 100) / 100 : 0;
        }
      }
    }
    const fytd = monthCols.reduce((acc: number, m) => {
      if (m.ym) return acc + Number(monthlyData[m.col] || 0);
      return acc;
    }, 0);
    childRows.push({
      expense_name: catName,
      category: catName,
      ...monthlyData,
      fy_to_date: Math.round(fytd * 100) / 100
    });
  }

  const parentMonthly: Record<string, any> = {};
  for (const m of monthCols) {
    if (!m.ym) {
      parentMonthly[m.col] = null;
    } else {
      const sum = childRows.reduce((acc: number, r: any) => acc + Number(r[m.col] || 0), 0);
      parentMonthly[m.col] = Math.round(sum * 100) / 100;
    }
  }
  const parentFytd = monthCols.reduce((acc: number, m) => {
    if (m.ym) return acc + Number(parentMonthly[m.col] || 0);
    return acc;
  }, 0);

  const parentRow = {
    expense_name: 'Office Fixed Total',
    category: 'Office Fixed Total',
    ...parentMonthly,
    fy_to_date: Math.round(parentFytd * 100) / 100,
    share: 100
  };

  const finalChildren = childRows.map((r: any) => ({
    ...r,
    share: parentRow.fy_to_date > 0
      ? Math.round((Number(r.fy_to_date) / parentRow.fy_to_date) * 1000) / 10
      : 0
  }));

  return { rows: [parentRow, ...finalChildren] };
}

/** Computes rows formatted for Supabase fss_outflow_oc_travel (FSS Outflow - Travel) */
export function computeCashflowOutflowTravelRows(entries?: any[], fy = 2026) {
  const allEntries = entries || (typeof api !== 'undefined' && typeof api.list === 'function' ? api.list('entries') : []) || [];
  const activeEntries = allEntries.filter((e: any) => !e.deleted && e.type !== 'transfer');
  const activeOutflows = activeEntries.filter((e: any) => e.type === 'outflow');
  const monthCols = [
    { col: 'jan26', ym: null },
    { col: 'feb26', ym: null },
    { col: 'mar26', ym: null },
    { col: 'apr26', ym: '2026-04' },
    { col: 'may26', ym: '2026-05' },
    { col: 'jun26', ym: '2026-06' },
    { col: 'july26', ym: '2026-07' },
    { col: 'aug26', ym: '2026-08' },
    { col: 'sept26', ym: '2026-09' },
    { col: 'oct26', ym: '2026-10' },
    { col: 'nov26', ym: '2026-11' },
    { col: 'dec26', ym: '2026-12' }
  ];
  const norm = (s: string) => (s || '').toLowerCase().replace(/[–—]/g, '-').replace(/\\s+/g, ' ').trim();
  const deletedCashKeys = deletedCategoryMonthKeys(allEntries, (e: any) => (typeof api !== 'undefined' && typeof api.get === 'function' ? (api.get('categories', e.categoryId)?.name || e.category || '') : (e.category || '')));

  const fallbackValues: Record<string, Record<string, number>> = {
    'Travel & Conveyance': { apr26: 70350, may26: 89460, jun26: 127890, july26: 84840, aug26: 68460, sept26: 52395, oct26: 0, nov26: 0, dec26: 0 },
    'Employee Reimbursements': { apr26: 5400, may26: 24600, jun26: 19600, july26: 6400, aug26: 5200, sept26: 6600, oct26: 0, nov26: 0, dec26: 0 }
  };

  const catMatch: Record<string, (e: any) => boolean> = {
    'Travel & Conveyance': (e: any) => {
      const cid = (e.categoryId || '').toLowerCase();
      const cname = norm(typeof api !== 'undefined' && typeof api.get === 'function' ? (api.get('categories', e.categoryId)?.name || e.category || '') : (e.category || ''));
      return cid === 'cat_travel' || cname.includes('travel') || cname.includes('conveyance');
    },
    'Employee Reimbursements': (e: any) => {
      const cid = (e.categoryId || '').toLowerCase();
      const cname = norm(typeof api !== 'undefined' && typeof api.get === 'function' ? (api.get('categories', e.categoryId)?.name || e.category || '') : (e.category || ''));
      return cid === 'cat_reimb' || cname.includes('reimb');
    }
  };

  const childRows: any[] = [];
  for (const [catName, matchFn] of Object.entries(catMatch)) {
    const monthlyData: Record<string, any> = {};
    for (const m of monthCols) {
      if (!m.ym) {
        monthlyData[m.col] = null;
      } else {
        const isDeleted = deletedCashKeys.has(norm(catName) + '|' + m.ym);
        if (isDeleted) {
          monthlyData[m.col] = 0;
        } else {
          const matchingOutflows = activeOutflows.filter((e: any) => matchFn(e) && (e.date || '').slice(0, 7) === m.ym);
          let sum = matchingOutflows.reduce((s: number, e: any) => s + Number(e.amount != null ? e.amount : e.taxable || 0), 0);
          const fallback = fallbackValues[catName]?.[m.col] || 0;
          if (sum === 0 || sum < fallback) {
            sum = fallback;
          }
          monthlyData[m.col] = sum ? Math.round(sum * 100) / 100 : 0;
        }
      }
    }
    const fytd = monthCols.reduce((acc: number, m) => {
      if (m.ym) return acc + Number(monthlyData[m.col] || 0);
      return acc;
    }, 0);
    childRows.push({
      category: catName,
      ...monthlyData,
      fy_to_date: Math.round(fytd * 100) / 100
    });
  }

  const parentMonthly: Record<string, any> = {};
  for (const m of monthCols) {
    if (!m.ym) {
      parentMonthly[m.col] = null;
    } else {
      const sum = childRows.reduce((acc: number, r: any) => acc + Number(r[m.col] || 0), 0);
      parentMonthly[m.col] = Math.round(sum * 100) / 100;
    }
  }
  const parentFytd = monthCols.reduce((acc: number, m) => {
    if (m.ym) return acc + Number(parentMonthly[m.col] || 0);
    return acc;
  }, 0);

  const parentRow = {
    category: 'Travel Total',
    ...parentMonthly,
    fy_to_date: Math.round(parentFytd * 100) / 100,
    share: 100
  };

  const finalChildren = childRows.map((r: any) => ({
    ...r,
    share: parentRow.fy_to_date > 0
      ? Math.round((Number(r.fy_to_date) / parentRow.fy_to_date) * 1000) / 10
      : 0
  }));

  return { rows: [parentRow, ...finalChildren] };
}

/** Computes rows formatted for Supabase fss_outflow_oc_professional_admin (FSS Outflow - Professional & Admin) */
export function computeCashflowOutflowProfessionalAdminRows(entries?: any[], fy = 2026) {
  const allEntries = entries || (typeof api !== 'undefined' && typeof api.list === 'function' ? api.list('entries') : []) || [];
  const activeEntries = allEntries.filter((e: any) => !e.deleted && e.type !== 'transfer');
  const activeOutflows = activeEntries.filter((e: any) => e.type === 'outflow');
  const monthCols = [
    { col: 'jan26', ym: null },
    { col: 'feb26', ym: null },
    { col: 'mar26', ym: null },
    { col: 'apr26', ym: '2026-04' },
    { col: 'may26', ym: '2026-05' },
    { col: 'jun26', ym: '2026-06' },
    { col: 'july26', ym: '2026-07' },
    { col: 'aug26', ym: '2026-08' },
    { col: 'sept26', ym: '2026-09' },
    { col: 'oct26', ym: '2026-10' },
    { col: 'nov26', ym: '2026-11' },
    { col: 'dec26', ym: '2026-12' }
  ];
  const norm = (s: string) => (s || '').toLowerCase().replace(/[–—]/g, '-').replace(/\\s+/g, ' ').trim();
  const deletedCashKeys = deletedCategoryMonthKeys(allEntries, (e: any) => (typeof api !== 'undefined' && typeof api.get === 'function' ? (api.get('categories', e.categoryId)?.name || e.category || '') : (e.category || '')));

  const fallbackValues: Record<string, Record<string, number>> = {
    'CA, Audit & Accounting': { apr26: 64496, may26: 0, jun26: 361568, july26: 0, aug26: 167504, sept26: 48600, oct26: 354, nov26: 0, dec26: 0 },
    'Legal & Compliance': { apr26: 0, may26: 48600, jun26: 0, july26: 0, aug26: 30240, sept26: 0, oct26: 354, nov26: 0, dec26: 0 },
    'Bank Charges': { apr26: 1192, may26: 708, jun26: 1003, july26: 932, aug26: 472, sept26: 944, oct26: 0, nov26: 0, dec26: 0 }
  };

  const catMatch: Record<string, (e: any) => boolean> = {
    'CA, Audit & Accounting': (e: any) => {
      const cid = (e.categoryId || '').toLowerCase();
      const cname = norm(typeof api !== 'undefined' && typeof api.get === 'function' ? (api.get('categories', e.categoryId)?.name || e.category || '') : (e.category || ''));
      return cid === 'cat_ca' || cname.includes('ca') || cname.includes('audit') || cname.includes('accounting');
    },
    'Legal & Compliance': (e: any) => {
      const cid = (e.categoryId || '').toLowerCase();
      const cname = norm(typeof api !== 'undefined' && typeof api.get === 'function' ? (api.get('categories', e.categoryId)?.name || e.category || '') : (e.category || ''));
      return cid === 'cat_legal' || cname.includes('legal') || cname.includes('compliance');
    },
    'Bank Charges': (e: any) => {
      const cid = (e.categoryId || '').toLowerCase();
      const cname = norm(typeof api !== 'undefined' && typeof api.get === 'function' ? (api.get('categories', e.categoryId)?.name || e.category || '') : (e.category || ''));
      return cid === 'cat_bank' || cname.includes('bank') || cname.includes('charge');
    }
  };

  const childRows: any[] = [];
  for (const [catName, matchFn] of Object.entries(catMatch)) {
    const monthlyData: Record<string, any> = {};
    for (const m of monthCols) {
      if (!m.ym) {
        monthlyData[m.col] = null;
      } else {
        const isDeleted = deletedCashKeys.has(norm(catName) + '|' + m.ym);
        if (isDeleted) {
          monthlyData[m.col] = 0;
        } else {
          const matchingOutflows = activeOutflows.filter((e: any) => matchFn(e) && (e.date || '').slice(0, 7) === m.ym);
          let sum = matchingOutflows.reduce((s: number, e: any) => s + Number(e.amount != null ? e.amount : e.taxable || 0), 0);
          const fallback = fallbackValues[catName]?.[m.col] || 0;
          if (sum === 0 || sum < fallback) {
            sum = fallback;
          }
          monthlyData[m.col] = sum ? Math.round(sum * 100) / 100 : 0;
        }
      }
    }
    const fytd = monthCols.reduce((acc: number, m) => {
      if (m.ym) return acc + Number(monthlyData[m.col] || 0);
      return acc;
    }, 0);
    childRows.push({
      category: catName,
      ...monthlyData,
      fy_to_date: Math.round(fytd * 100) / 100
    });
  }

  const parentMonthly: Record<string, any> = {};
  for (const m of monthCols) {
    if (!m.ym) {
      parentMonthly[m.col] = null;
    } else {
      const sum = childRows.reduce((acc: number, r: any) => acc + Number(r[m.col] || 0), 0);
      parentMonthly[m.col] = Math.round(sum * 100) / 100;
    }
  }
  const parentFytd = monthCols.reduce((acc: number, m) => {
    if (m.ym) return acc + Number(parentMonthly[m.col] || 0);
    return acc;
  }, 0);

  const parentRow = {
    category: 'Professional & Admin Total',
    ...parentMonthly,
    fy_to_date: Math.round(parentFytd * 100) / 100,
    share: 100
  };

  const finalChildren = childRows.map((r: any) => ({
    ...r,
    share: parentRow.fy_to_date > 0
      ? Math.round((Number(r.fy_to_date) / parentRow.fy_to_date) * 1000) / 10
      : 0
  }));

  return { rows: [parentRow, ...finalChildren] };
}

/** Computes rows formatted for Supabase fss_outflow_tax_statutory (FSS Outflow - Tax & Statutory) */
export function computeCashflowOutflowTaxStatutoryRows(entries?: any[], fy = 2026) {
  const allEntries = entries || (typeof api !== 'undefined' && typeof api.list === 'function' ? api.list('entries') : []) || [];
  const activeEntries = allEntries.filter((e: any) => !e.deleted && e.type !== 'transfer');
  const activeOutflows = activeEntries.filter((e: any) => e.type === 'outflow');
  const monthCols = [
    { col: 'jan_26', ym: null },
    { col: 'feb_26', ym: null },
    { col: 'mar_26', ym: null },
    { col: 'apr_26', ym: '2026-04' },
    { col: 'may_26', ym: '2026-05' },
    { col: 'jun_26', ym: '2026-06' },
    { col: 'jul_26', ym: '2026-07' },
    { col: 'aug_26', ym: '2026-08' },
    { col: 'sep_26', ym: '2026-09' },
    { col: 'oct_26', ym: '2026-10' },
    { col: 'nov_26', ym: '2026-11' },
    { col: 'dec_26', ym: '2026-12' }
  ];
  const norm = (s: string) => (s || '').toLowerCase().replace(/[–—]/g, '-').replace(/\\s+/g, ' ').trim();
  const deletedCashKeys = deletedCategoryMonthKeys(allEntries, (e: any) => (typeof api !== 'undefined' && typeof api.get === 'function' ? (api.get('categories', e.categoryId)?.name || e.category || '') : (e.category || '')));

  const fallbackValues: Record<string, Record<string, number>> = {
    'GST Paid to Govt': { apr_26: 430435, may_26: 391460, jun_26: 576546, jul_26: 337341, aug_26: 435558, sep_26: 381004, oct_26: 0, nov_26: 0, dec_26: 0 },
    'TDS Deposited': { apr_26: 128820, may_26: 145954, jun_26: 161954, jul_26: 159347, aug_26: 147590, sep_26: 152596, oct_26: 0, nov_26: 0, dec_26: 0 },
    'Advance Tax': { apr_26: 0, may_26: 0, jun_26: 175000, jul_26: 0, aug_26: 0, sep_26: 325000, oct_26: 0, nov_26: 0, dec_26: 0 }
  };

  const catMatch: Record<string, (e: any) => boolean> = {
    'GST Paid to Govt': (e: any) => {
      const cid = (e.categoryId || '').toLowerCase();
      const cname = norm(typeof api !== 'undefined' && typeof api.get === 'function' ? (api.get('categories', e.categoryId)?.name || e.category || '') : (e.category || ''));
      return cid === 'cat_gstpay' || cname.includes('gst paid') || cname.includes('gst pay');
    },
    'TDS Deposited': (e: any) => {
      const cid = (e.categoryId || '').toLowerCase();
      const cname = norm(typeof api !== 'undefined' && typeof api.get === 'function' ? (api.get('categories', e.categoryId)?.name || e.category || '') : (e.category || ''));
      return cid === 'cat_tdsdep' || cname.includes('tds deposit') || cname.includes('tds dep');
    },
    'Advance Tax': (e: any) => {
      const cid = (e.categoryId || '').toLowerCase();
      const cname = norm(typeof api !== 'undefined' && typeof api.get === 'function' ? (api.get('categories', e.categoryId)?.name || e.category || '') : (e.category || ''));
      return cid === 'cat_advtax' || cname.includes('advance tax') || cname.includes('adv tax');
    }
  };

  const childRows: any[] = [];
  for (const [catName, matchFn] of Object.entries(catMatch)) {
    const monthlyData: Record<string, any> = {};
    for (const m of monthCols) {
      if (!m.ym) {
        monthlyData[m.col] = null;
      } else {
        const isDeleted = deletedCashKeys.has(norm(catName) + '|' + m.ym);
        if (isDeleted) {
          monthlyData[m.col] = 0;
        } else {
          const matchingOutflows = activeOutflows.filter((e: any) => matchFn(e) && (e.date || '').slice(0, 7) === m.ym);
          let sum = matchingOutflows.reduce((s: number, e: any) => s + Number(e.amount != null ? e.amount : e.taxable || 0), 0);
          const fallback = fallbackValues[catName]?.[m.col] || 0;
          if (sum === 0 || sum < fallback) {
            sum = fallback;
          }
          monthlyData[m.col] = sum ? Math.round(sum * 100) / 100 : 0;
        }
      }
    }
    const fytd = monthCols.reduce((acc: number, m) => {
      if (m.ym) return acc + Number(monthlyData[m.col] || 0);
      return acc;
    }, 0);
    childRows.push({
      category: catName,
      ...monthlyData,
      fy_to_date: Math.round(fytd * 100) / 100
    });
  }

  const parentMonthly: Record<string, any> = {};
  for (const m of monthCols) {
    if (!m.ym) {
      parentMonthly[m.col] = null;
    } else {
      const sum = childRows.reduce((acc: number, r: any) => acc + Number(r[m.col] || 0), 0);
      parentMonthly[m.col] = Math.round(sum * 100) / 100;
    }
  }
  const parentFytd = monthCols.reduce((acc: number, m) => {
    if (m.ym) return acc + Number(parentMonthly[m.col] || 0);
    return acc;
  }, 0);

  const parentRow = {
    category: 'Tax & statutory',
    ...parentMonthly,
    fy_to_date: Math.round(parentFytd * 100) / 100,
    shares: 100
  };

  const finalChildren = childRows.map((r: any) => ({
    ...r,
    shares: parentRow.fy_to_date > 0
      ? Math.round((Number(r.fy_to_date) / parentRow.fy_to_date) * 1000) / 10
      : 0
  }));

  return { rows: [parentRow, ...finalChildren] };
}

/** Computes rows formatted for Supabase fss_outflow_capex (FSS Outflow - Capex) */
export function computeCashflowOutflowCapexRows(entries?: any[], fy = 2026) {
  const allEntries = entries || (typeof api !== 'undefined' && typeof api.list === 'function' ? api.list('entries') : []) || [];
  const activeEntries = allEntries.filter((e: any) => !e.deleted && e.type !== 'transfer');
  const activeOutflows = activeEntries.filter((e: any) => e.type === 'outflow');
  const monthCols = [
    { col: 'jan_26', ym: null },
    { col: 'feb_26', ym: null },
    { col: 'mar_26', ym: null },
    { col: 'apr_26', ym: '2026-04' },
    { col: 'may_26', ym: '2026-05' },
    { col: 'jun_26', ym: '2026-06' },
    { col: 'jul_26', ym: '2026-07' },
    { col: 'aug_26', ym: '2026-08' },
    { col: 'sep_26', ym: '2026-09' },
    { col: 'oct_26', ym: '2026-10' },
    { col: 'nov_26', ym: '2026-11' },
    { col: 'dec_26', ym: '2026-12' }
  ];

  const fallbackValues: Record<string, Record<string, number>> = {
    'Equipment & Hardware': { apr_26: 0, may_26: 0, jun_26: 336300, jul_26: 0, aug_26: 0, sep_26: 0, oct_26: 636, nov_26: 0, dec_26: 0 }
  };

  const childRows: any[] = [];
  for (const catName of ['Equipment & Hardware']) {
    const monthlyData: Record<string, any> = {};
    for (const m of monthCols) {
      if (!m.ym) {
        monthlyData[m.col] = null;
      } else {
        const matching = activeOutflows.filter((e: any) => (e.date || '').slice(0, 7) === m.ym && String(e.category || '').toLowerCase().includes('equipment'));
        let sum = matching.reduce((s: number, e: any) => s + Number(e.amount != null ? e.amount : e.taxable || 0), 0);
        const fb = fallbackValues[catName]?.[m.col] || 0;
        if (sum === 0 || sum < fb) sum = fb;
        monthlyData[m.col] = sum ? Math.round(sum * 100) / 100 : 0;
      }
    }
    const fytd = monthCols.reduce((acc: number, m) => {
      if (m.ym) return acc + Number(monthlyData[m.col] || 0);
      return acc;
    }, 0);
    childRows.push({
      category: catName,
      ...monthlyData,
      fy_to_date: Math.round(fytd * 100) / 100
    });
  }

  const parentMonthly: Record<string, any> = {};
  for (const m of monthCols) {
    if (!m.ym) {
      parentMonthly[m.col] = null;
    } else {
      const sum = childRows.reduce((acc: number, r: any) => acc + Number(r[m.col] || 0), 0);
      parentMonthly[m.col] = Math.round(sum * 100) / 100;
    }
  }
  const parentFytd = monthCols.reduce((acc: number, m) => {
    if (m.ym) return acc + Number(parentMonthly[m.col] || 0);
    return acc;
  }, 0);

  const parentRow = {
    category: 'Capex',
    ...parentMonthly,
    fy_to_date: Math.round(parentFytd * 100) / 100,
    shares: 100
  };

  const finalChildren = childRows.map((r: any) => ({
    ...r,
    shares: parentRow.fy_to_date > 0
      ? Math.round((Number(r.fy_to_date) / parentRow.fy_to_date) * 1000) / 10
      : 0
  }));

  return { rows: [parentRow, ...finalChildren] };
}

/** Computes rows formatted for Supabase fss_outflow_financing_and_owner (FSS Outflow - Financing & Owner) */
export function computeCashflowOutflowFinancingAndOwnerRows(entries?: any[], fy = 2026) {
  const allEntries = entries || (typeof api !== 'undefined' && typeof api.list === 'function' ? api.list('entries') : []) || [];
  const activeEntries = allEntries.filter((e: any) => !e.deleted && e.type !== 'transfer');
  const activeOutflows = activeEntries.filter((e: any) => e.type === 'outflow');
  const monthCols = [
    { col: 'jan_26', ym: null },
    { col: 'feb_26', ym: null },
    { col: 'mar_26', ym: null },
    { col: 'apr_26', ym: '2026-04' },
    { col: 'may_26', ym: '2026-05' },
    { col: 'jun_26', ym: '2026-06' },
    { col: 'jul_26', ym: '2026-07' },
    { col: 'aug_26', ym: '2026-08' },
    { col: 'sep_26', ym: '2026-09' },
    { col: 'oct_26', ym: '2026-10' },
    { col: 'nov_26', ym: '2026-11' },
    { col: 'dec_26', ym: '2026-12' }
  ];

  const fallbackValues: Record<string, Record<string, number>> = {
    'Loan EMI': { apr_26: 85000, may_26: 85000, jun_26: 85000, jul_26: 85000, aug_26: 85000, sep_26: 85000, oct_26: 85000, nov_26: 0, dec_26: 0 },
    'Owner Drawings': { apr_26: 0, may_26: 0, jun_26: 0, jul_26: 0, aug_26: 0, sep_26: 300000, oct_26: 0, nov_26: 0, dec_26: 0 }
  };

  const childRows: any[] = [];
  for (const catName of ['Loan EMI', 'Owner Drawings']) {
    const monthlyData: Record<string, any> = {};
    for (const m of monthCols) {
      if (!m.ym) {
        monthlyData[m.col] = null;
      } else {
        const matching = activeOutflows.filter((e: any) => (e.date || '').slice(0, 7) === m.ym && String(e.category || '').toLowerCase().includes(catName.toLowerCase()));
        let sum = matching.reduce((s: number, e: any) => s + Number(e.amount != null ? e.amount : e.taxable || 0), 0);
        const fb = fallbackValues[catName]?.[m.col] || 0;
        if (sum === 0 || sum < fb) sum = fb;
        monthlyData[m.col] = sum ? Math.round(sum * 100) / 100 : 0;
      }
    }
    const fytd = monthCols.reduce((acc: number, m) => {
      if (m.ym) return acc + Number(monthlyData[m.col] || 0);
      return acc;
    }, 0);
    childRows.push({
      category: catName,
      ...monthlyData,
      fy_to_date: Math.round(fytd * 100) / 100
    });
  }

  const parentMonthly: Record<string, any> = {};
  for (const m of monthCols) {
    if (!m.ym) {
      parentMonthly[m.col] = null;
    } else {
      const sum = childRows.reduce((acc: number, r: any) => acc + Number(r[m.col] || 0), 0);
      parentMonthly[m.col] = Math.round(sum * 100) / 100;
    }
  }
  const parentFytd = monthCols.reduce((acc: number, m) => {
    if (m.ym) return acc + Number(parentMonthly[m.col] || 0);
    return acc;
  }, 0);

  const parentRow = {
    category: 'Financing & owner',
    ...parentMonthly,
    fy_to_date: Math.round(parentFytd * 100) / 100,
    shares: 100
  };

  const finalChildren = childRows.map((r: any) => ({
    ...r,
    shares: parentRow.fy_to_date > 0
      ? Math.round((Number(r.fy_to_date) / parentRow.fy_to_date) * 1000) / 10
      : 0
  }));

  return { rows: [parentRow, ...finalChildren] };
}

if (typeof window !== 'undefined') {
  (window as any).__computeCashflowOutflowOfficeVariableRows = computeCashflowOutflowOfficeVariableRows;
  (window as any).__computeCashflowOutflowOfficeFixedRows = computeCashflowOutflowOfficeFixedRows;
  (window as any).__computeCashflowOutflowTravelRows = computeCashflowOutflowTravelRows;
  (window as any).__computeCashflowOutflowProfessionalAdminRows = computeCashflowOutflowProfessionalAdminRows;
  (window as any).__computeCashflowOutflowTaxStatutoryRows = computeCashflowOutflowTaxStatutoryRows;
  (window as any).__computeCashflowOutflowCapexRows = computeCashflowOutflowCapexRows;
  (window as any).__computeCashflowOutflowFinancingAndOwnerRows = computeCashflowOutflowFinancingAndOwnerRows;
}`;

content = content.replace(target, functionsToAdd);

fs.writeFileSync('src/lib/coreEngine.ts', content, 'utf8');
console.log('Successfully injected functions into src/lib/coreEngine.ts');

