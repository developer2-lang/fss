import React, { useEffect, useState, useCallback, useRef } from 'react';
import { boot, go, route, render, S, api, Store, FileStore, PAYMENT_MODES, getCashflowSummaryUiRows, computeCashflowInflowRows, computeCashflowPeopleRows, computeCashflowOutflowProjectCostRows, computeCashflowOutflowCapexRows, computeCashflowOutflowFinancingAndOwnerRows, computeCashflowOutflowOfficeFixedRows, computeCashflowOutflowOfficeVariableRows, computeCashflowOutflowTravelRows, computeCashflowOutflowProfessionalAdminRows, computeCashflowOutflowTaxStatutoryRows } from './lib/coreEngine';
import { FssTransactionInput, FormAttachmentBucket, SupabaseService, isSupabaseConfigured, STATE_NAME_TO_CODE, STATE_CODE_TO_NAME, computeByAccountCreditedDebitedRows } from './lib/supabase';
import { AddClientModal } from './components/AddClientModal';
import { AddVendorModal } from './components/AddVendorModal';
import { AddEmployeeModal } from './components/AddEmployeeModal';
import { AddOtherPartyModal } from './components/AddOtherPartyModal';
import { AddProjectModal } from './components/AddProjectModal';
import { AddDepartmentModal } from './components/AddDepartmentModal';
import { AddBankAccountModal } from './components/AddBankAccountModal';
import { AddCategoryModal } from './components/AddCategoryModal';
import { SupabaseTransactionModal } from './components/SupabaseTransactionModal';
import './styles/index.css';

function replaceMasterRows(
  localRows: any[],
  supabaseRows: any[],
  convert: (row: any) => any,
  matches: (local: any, remote: any) => boolean
) {
  const usedLocalRows = new Set<any>();
  const mappedRows = (supabaseRows || []).map((remote, remoteIndex) => {
    const local = (localRows || []).find(candidate => !usedLocalRows.has(candidate) && matches(candidate, remote));
    if (local) usedLocalRows.add(local);
    const converted = convert(remote);
    return {
      ...converted,
      id: local?.id ?? converted.id,
      monthlyBalances: local?.monthlyBalances || converted.monthlyBalances,
      supabase_id: remote.id,
      _localOrder: local ? localRows.indexOf(local) : localRows.length + remoteIndex
    };
  });
  return mappedRows
    .sort((a, b) => a._localOrder - b._localOrder)
    .map(({ _localOrder, ...row }) => row);
}

function formAttachmentsFromValue(value: any, bucket: string, idPrefix: string): any[] {
  let items: any[] = [];
  if (Array.isArray(value)) {
    items = value;
  } else if (typeof value === 'string' && value) {
    try {
      const parsed = JSON.parse(value);
      items = Array.isArray(parsed) ? parsed : [value];
    } catch {
      items = [value];
    }
  }
  return items.map((item, index) => {
    const raw = typeof item === 'string' ? item : '';
    const url = /^https?:\/\//i.test(raw) ? raw : item?.url || '';
    let storagePath = typeof item === 'object'
      ? item.storagePath || item.storage_path || item.path || ''
      : '';
    if (!storagePath && raw && !url) storagePath = raw;
    if (!storagePath && url) {
      try {
        const decodedPath = decodeURIComponent(new URL(url).pathname);
        const marker = `/object/public/${bucket}/`;
        const markerIndex = decodedPath.indexOf(marker);
        if (markerIndex >= 0) storagePath = decodedPath.slice(markerIndex + marker.length);
      } catch {
        if (!/^https?:\/\//i.test(url)) storagePath = url;
      }
    }
    const publicUrl = url || (storagePath
      ? SupabaseService.getFormAttachmentPublicUrl(bucket as FormAttachmentBucket, storagePath)
      : '');
    const name = item?.name || decodeURIComponent((storagePath || publicUrl).split('/').pop() || 'Attachment');
    return {
      id: item?.id || `${idPrefix}_${index}`,
      name,
      type: item?.type || '',
      size: Number(item?.size) || 0,
      ...(storagePath ? { storagePath } : {}),
      ...(publicUrl ? { url: publicUrl } : {})
    };
  });
}

function recordSupabaseAudit(
  action: string,
  entity: string,
  entityId: string | number,
  summary: string,
  before: any,
  after: any
): Promise<any> {
  const user = (window as any).api?.me?.();
  const writeAuditLog = (window as any).__writeSupabaseAuditLog;
  if (typeof writeAuditLog !== 'function') {
    const error = new Error('Supabase audit log service is unavailable.');
    console.error(error);
    (window as any).IuovaCore?.toast?.(error.message, 'error');
    return Promise.resolve(null);
  }
  return writeAuditLog({
    ts: new Date().toISOString(),
    userId: String(user?.id || ''),
    userName: String(user?.name || ''),
    action,
    entity,
    entityId: String(entityId),
    summary,
    changes: { before: before ?? null, after: after ?? null }
  }).catch((error: any) => {
    console.error('Supabase audit log write failed:', error);
    (window as any).IuovaCore?.toast?.(auditFailureMessage(error), 'error');
    return null;
  });
}

function transactionAuditSummary(transaction: any): string {
  const data = (window as any).Store?.data || {};
  const findName = (collection: string, id: any, field = 'name') =>
    (data[collection] || []).find((item: any) => String(item.id) === String(id))?.[field] || '';
  const type = String(transaction?.transaction_type || transaction?.type || 'Transaction').toLowerCase();
  const typeLabel = type.includes('inflow') ? 'Inflow' : type.includes('transfer') ? 'Transfer' : 'Outflow';
  const amount = Math.abs(Number(
    transaction?.net_cash ?? transaction?.netCash ?? transaction?.amount ??
    transaction?.taxable_amount ?? transaction?.taxable
  ) || 0);
  const amountLabel = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(amount);
  const category = transaction?.category || transaction?.categoryName ||
    findName('categories', transaction?.categoryId);
  const party = transaction?.party_name || transaction?.partyName ||
    transaction?.party || findName('parties', transaction?.partyId);
  const project = transaction?.project_name || transaction?.projectName ||
    transaction?.project || findName('projects', transaction?.projectId);
  const transferAccounts = [
    transaction?.transfer_from_account_name || transaction?.transferFromAccountName ||
      findName('accounts', transaction?.accountId),
    transaction?.transfer_to_account_name || transaction?.transferToAccountName ||
      findName('accounts', transaction?.toAccountId)
  ].filter(Boolean);
  return [
    `${typeLabel} ₹${amountLabel}`,
    typeLabel === 'Transfer' ? transferAccounts.join(' → ') : category,
    typeLabel === 'Transfer' ? '' : party,
    project
  ].filter(Boolean).join(' · ');
}

let creditedDebitedSyncQueue: Promise<void> = Promise.resolve();
let byAccountTransferSyncKey = '';

function syncCreditedDebitedFromEntries(entries?: any[]): Promise<void> {
  const sync = async () => {
    const currentFy = (typeof S !== 'undefined' && S.fy) ? S.fy : 2026;
    const getEffectiveEntries = (window as any).__getAllDeduplicatedTransactions;
    const effectiveEntries = typeof getEffectiveEntries === 'function'
      ? getEffectiveEntries()
      : entries || Store.data?.entries || [];
    const computedCD = computeByAccountCreditedDebitedRows(
      effectiveEntries,
      Store.data?.fss_by_account_credited_debited || [],
      Store.data?.accounts || [],
      currentFy
    );
    if (computedCD.length > 0) {
      const syncedCD = await SupabaseService.syncByAccountCreditedDebitedToSupabase(computedCD, currentFy);
      if (Store.data) {
        Store.data.fss_by_account_credited_debited = syncedCD;
        Store.persist();
      }
      render({ keepScroll: true });
    }
  };
  const operation = creditedDebitedSyncQueue.then(sync, sync);
  creditedDebitedSyncQueue = operation.catch(err => {
    console.error('Credited/debited summary sync failed:', err);
    const reportError = (window as any).__reportAccountSummarySyncError;
    if (typeof reportError === 'function') reportError(err);
  });
  return operation;
}

export interface CloudStatus {
  configured: boolean;
  connected: boolean;
  syncing: boolean;
  lastSynced: string | null;
  error: string | null;
  clientCount?: number;
  vendorCount?: number;
  employeeCount?: number;
  otherPartyCount?: number;
  projectCount?: number;
  departmentCount?: number;
  bankAccountCount?: number;
  categoryCount?: number;
  orderCount?: number;
  transactionCount?: number;
  operationReceiptCount?: number;
  incomeCount?: number;
  financingCount?: number;
  cashInflowCount?: number;
  peopleCount?: number;
  projectCostCount?: number;
  capexCount?: number;
}

const CASH_OUTFLOW_MONTH_COLS = [
  'jan_26', 'feb_26', 'mar_26', 'apr_26', 'may_26', 'jun_26',
  'jul_26', 'aug_26', 'sep_26', 'oct_26', 'nov_26', 'dec_26'
];

function buildCashOutflowSummaryRows(uiRows: any[] = []) {
  const normalized = (value: any) => String(value || '').toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
  const categories = [
    'Operating costs',
    'Project costs',
    'Tax & statutory',
    'Capex',
    'Financing & owner'
  ];
  const uiRowsByName = new Map(uiRows.map(row => [normalized(row.category_name), row]));
  const summaryRows = categories.map((category_name, index) => {
    const uiRow = uiRowsByName.get(normalized(category_name));
    if (!uiRow) {
      throw new Error(`Could not read "${category_name}" from the cash outflow statement; Supabase was not changed.`);
    }
    const row: Record<string, any> = {
      category_name,
      sort_order: index + 1
    };
    for (const month of CASH_OUTFLOW_MONTH_COLS) {
      if (!Object.prototype.hasOwnProperty.call(uiRow, month)) {
        row[month] = null;
        continue;
      }
      const value = Number(uiRow[month]);
      if (!Number.isFinite(value)) {
        throw new Error(`Invalid ${month} value for "${category_name}"; Supabase was not changed.`);
      }
      row[month] = Math.round(value * 100) / 100;
    }
    row.fy_to_date = Math.round(CASH_OUTFLOW_MONTH_COLS.slice(3).reduce((sum, month) => sum + Number(row[month] || 0), 0) * 100) / 100;
    return row;
  });

  const totalFyToDate = summaryRows.reduce((sum, row) => sum + Number(row.fy_to_date || 0), 0);
  for (const row of summaryRows) {
    row.shares = totalFyToDate > 0
      ? Math.round((Number(row.fy_to_date || 0) / totalFyToDate) * 1000) / 10
      : 0;
  }
  const totalRow: Record<string, any> = {
    category_name: 'FSS Cash Outflow Total',
    sort_order: 6,
    fy_to_date: totalFyToDate,
    shares: 100
  };
  for (const month of CASH_OUTFLOW_MONTH_COLS) {
    const values = summaryRows
      .map(row => row[month])
      .filter((value): value is number => value !== null && value !== undefined);
    totalRow[month] = values.length
      ? Math.round(values.reduce((sum, value) => sum + value, 0) * 100) / 100
      : null;
  }
  return [...summaryRows, totalRow];
}

// Convert Supabase fss_client and fss_client_people rows into CRM party format
export function convertFssClientToParty(client: any, people: any[] = []) {
  const contacts = (people || []).map((p: any, idx: number) => {
    const tags: string[] = [];
    if (p.receives_accounts) tags.push('accounts');
    if (p.receives_projects) tags.push('projects');
    if (p.receives_management) tags.push('management');
    return {
      id: p.id || `ct_${idx}`,
      name: p.name || '',
      designation: p.designation || '',
      email: p.email || '',
      phone: p.phone || '',
      whatsapp: Boolean(p.on_whatsapp),
      tags
    };
  });

  const rawState = (client.state || '').trim();
  const stateCode = STATE_NAME_TO_CODE[rawState.toLowerCase()] || (STATE_CODE_TO_NAME[rawState] ? rawState : '');

  return {
    id: client.id,
    kind: 'client',
    name: client.client_name,
    gstin: client.gstin || '',
    stateCode: stateCode,
    state: rawState || (stateCode ? STATE_CODE_TO_NAME[stateCode] : ''),
    address: client.billing_address || '',
    pincode: client.pin_code || '',
    pan: client.pan || '',
    tan: client.tan || '',
    gstType: (client.default_gst_type || '').toLowerCase().includes('igst') ? 'inter' : 'intra',
    creditDays: client.credit_period ?? 30,
    notes: client.notes || '',
    bank: client.bank_account_number ? {
      accName: client.bank_account_name || '',
      bankName: client.bank_name || '',
      accNo: client.bank_account_number || '',
      ifsc: client.bank_ifsc || '',
      upi: ''
    } : null,
    contacts,
    email: contacts.map((c: any) => c.email).filter(Boolean).join(', '),
    phone: contacts.find((c: any) => c.phone)?.phone || '',
    active: client.status !== 'Inactive',
    createdAt: client.created_at || new Date().toISOString()
  };
}

// Convert Supabase fss_vendor and fss_vendor_people rows into CRM party format
export function convertFssVendorToParty(vendor: any, people: any[] = []) {
  const contacts = (people || []).map((p: any, idx: number) => {
    const tags: string[] = [];
    if (p.receives_accounts) tags.push('accounts');
    if (p.receives_projects) tags.push('projects');
    if (p.receives_management) tags.push('management');
    return {
      id: p.id || `ct_${idx}`,
      name: p.name || '',
      designation: p.designation || '',
      email: p.email || '',
      phone: p.phone || '',
      whatsapp: Boolean(p.on_whatsapp),
      tags
    };
  });

  const rawState = (vendor.state || '').trim();
  const stateCode = STATE_NAME_TO_CODE[rawState.toLowerCase()] || (STATE_CODE_TO_NAME[rawState] ? rawState : '');
  const hasBank = vendor.account_number || vendor.ifsc_code || vendor.bank_name || vendor.account_holder_name || vendor.upi_id;

  return {
    id: vendor.id,
    kind: 'vendor',
    name: vendor.vendor_name,
    gstin: vendor.gstin || '',
    stateCode: stateCode,
    state: rawState || (stateCode ? STATE_CODE_TO_NAME[stateCode] : ''),
    address: vendor.billing_address || '',
    pincode: vendor.pin_code || '',
    pan: vendor.pan || '',
    tan: '',
    gstType: (vendor.default_gst_type || '').toLowerCase().includes('igst') ? 'inter' : 'intra',
    creditDays: vendor.credit_period ?? 30,
    notes: vendor.notes || '',
    bank: hasBank ? {
      accName: vendor.account_holder_name || '',
      bankName: vendor.bank_name || '',
      accNo: vendor.account_number || '',
      ifsc: vendor.ifsc_code || '',
      upi: vendor.upi_id || ''
    } : null,
    contacts,
    email: contacts.map((c: any) => c.email).filter(Boolean).join(', '),
    phone: contacts.find((c: any) => c.phone)?.phone || '',
    active: vendor.status !== 'Inactive',
    createdAt: vendor.created_at || new Date().toISOString()
  };
}

// Convert Supabase fss_employe rows into CRM party format
export function convertFssEmployeToParty(emp: any, departments: any[] = []) {
  const rawDept = (emp.department || '').trim();
  const matchedDept = (departments || []).find((d: any) =>
    d.name.toLowerCase() === rawDept.toLowerCase() || d.id === rawDept
  );
  const departmentId = matchedDept ? matchedDept.id : 'dep_ops';

  return {
    id: String(emp.id),
    supabase_id: emp.id,
    kind: 'employee',
    name: emp.name,
    departmentId,
    designation: emp.designation || '',
    monthlySalary: Number(emp.monthly_salary) || 0,
    joinDate: emp.joined || '',
    email: emp.emails || '',
    phone: emp.phone || '',
    active: emp.is_active !== false,
    createdAt: emp.created_at || new Date().toISOString()
  };
}

// Convert Supabase fss_other_parties rows into CRM party format
export function convertFssOtherPartyToParty(op: any) {
  let gstType = 'none';
  if (op.default_gst_type === 'Regular GST') gstType = 'intra';
  else if (op.default_gst_type === 'Composition GST') gstType = 'Composition GST';
  else if (op.default_gst_type === 'Unregistered') gstType = 'Unregistered';
  else gstType = 'none';

  return {
    id: String(op.id),
    supabase_id: op.id,
    kind: 'other',
    name: op.name,
    gstin: op.gstin || '',
    gstType,
    email: op.emails || '',
    phone: op.phone || '',
    active: op.is_active !== false,
    createdAt: op.created_at || new Date().toISOString()
  };
}

// Convert Supabase fss_projects rows into CRM project format
export function convertFssProjectToLocal(proj: any, clients: any[] = [], departments: any[] = []) {
  // Resolve clientId
  let clientId = '';
  const clientList = (clients || []).filter((c: any) => c.kind === 'client');
  const numClientId = Number(proj.client_id);
  if (!isNaN(numClientId) && numClientId > 0 && numClientId <= clientList.length) {
    clientId = clientList[numClientId - 1].id;
  } else {
    const match = clientList.find((c: any) => c.id === String(proj.client_id) || c.supabase_id === proj.client_id);
    clientId = match ? match.id : '';
  }

  // Resolve departmentId
  const rawDept = (proj.department || '').trim();
  const matchedDept = (departments || []).find((d: any) =>
    d.name.toLowerCase() === rawDept.toLowerCase() || d.id === rawDept
  );
  const departmentId = matchedDept ? matchedDept.id : 'dep_design';

  // Map status
  let status = 'active';
  const rawStatus = (proj.status || '').toLowerCase();
  if (rawStatus === 'completed') status = 'completed';
  else if (rawStatus === 'on hold' || rawStatus === 'on-hold') status = 'on-hold';
  else if (rawStatus === 'inactive') status = 'inactive';
  else status = 'active';

  return {
    id: String(proj.id),
    supabase_id: proj.id,
    code: proj.project_code,
    name: proj.project_name,
    clientId,
    departmentId,
    contractValue: Number(proj.contract_value) || 0,
    startDate: proj.start_date || '',
    status,
    active: status !== 'inactive',
    createdAt: proj.created_at || new Date().toISOString()
  };
}

// Convert Supabase fss_departments rows into CRM department format
export function convertFssDepartmentToLocal(dept: any) {
  return {
    id: String(dept.id),
    supabase_id: dept.id,
    name: dept.department_name,
    managerName: dept.manager || '',
    managerEmail: dept.manager_email || '',
    active: true,
    createdAt: dept.created_at || new Date().toISOString()
  };
}

// Convert Supabase fss_bank_accounts rows into CRM bank account format
export function convertFssBankAccountToLocal(acc: any) {
  let localType: 'bank' | 'cash' | 'fd' = 'bank';
  const rawType = (acc.account_type || '').toLowerCase();
  if (rawType === 'cash') localType = 'cash';
  else if (rawType === 'fixed deposit' || rawType === 'fd') localType = 'fd';
  else localType = 'bank';

  return {
    id: String(acc.id),
    supabase_id: acc.id,
    name: acc.account_name,
    type: localType,
    number: acc.account_number_masked || '',
    openingBalance: Number(acc.opening_balance) || 0,
    openingBalanceDate: acc.opening_balance_date || '2025-04-01',
    active: true,
    createdAt: acc.created_at || new Date().toISOString()
  };
}

// Convert Supabase fss_categories rows into CRM category format
export function convertFssCategoryToLocal(sc: any, existingCategories: any[] = []) {
  const match = (existingCategories || []).find((c: any) =>
    (c.supabase_id && c.supabase_id === sc.id) ||
    (c.name && c.name.trim().toLowerCase() === (sc.category_name || '').trim().toLowerCase())
  );
  const localId = match ? match.id : `cat_${sc.id}`;

  let type: 'outflow' | 'inflow' = 'outflow';
  if (sc.fss_type?.name) {
    type = sc.fss_type.name.toLowerCase() === 'inflow' ? 'inflow' : 'outflow';
  } else if (sc.type_id === 3) {
    type = 'inflow';
  }

  const group = sc.fss_category_group?.name || match?.group || (type === 'inflow' ? 'Operating Receipts' : 'Office – Fixed');

  let partyKind: 'client' | 'vendor' | 'employee' | 'other' = 'vendor';
  const rawLinked = sc.fss_category_linked_to?.name || match?.partyKind || '';
  if (rawLinked.toLowerCase().includes('client')) partyKind = 'client';
  else if (rawLinked.toLowerCase().includes('employee')) partyKind = 'employee';
  else if (rawLinked.toLowerCase().includes('other')) partyKind = 'other';
  else partyKind = 'vendor';

  let kind: 'operating' | 'tax' | 'capex' | 'financing' = 'operating';
  const rawNature = sc.fss_category_nature?.name || match?.kind || '';
  if (rawNature.toLowerCase().includes('statutory') || rawNature.toLowerCase().includes('tax')) kind = 'tax';
  else if (rawNature.toLowerCase().includes('capex')) kind = 'capex';
  else if (rawNature.toLowerCase().includes('financing') || rawNature.toLowerCase().includes('owner')) kind = 'financing';
  else kind = 'operating';

  let bucket = match?.bucket || '';
  const rawBucket = sc.fss_category_summary_bucket?.name || '';
  if (rawBucket) {
    const lb = rawBucket.toLowerCase();
    if (lb.includes('project costs')) bucket = 'proj_cost';
    else if (lb.includes('tax') || lb.includes('statutory')) bucket = 'tax';
    else if (lb.includes('capex')) bucket = 'capex';
    else if (lb.includes('financing & owner') || (type === 'outflow' && lb.includes('financing'))) bucket = 'fin_out';
    else if (lb.includes('operating receipts')) bucket = 'op_rec';
    else if (lb.includes('other income')) bucket = 'oth_inc';
    else if (lb.includes('financing (inflow)') || (type === 'inflow' && lb.includes('financing'))) bucket = 'fin_in';
    else if (lb.includes('operating costs')) bucket = 'op_cost';
  }
  if (!bucket) {
    if (type === 'inflow') {
      bucket = (kind === 'financing' || (sc.category_name || '').toLowerCase().includes('loan') || (sc.category_name || '').toLowerCase().includes('capital')) ? 'fin_in' : (group.toLowerCase().includes('other income') ? 'oth_inc' : 'op_rec');
    } else {
      if (group === 'Project Costs') bucket = 'proj_cost';
      else bucket = ({ tax: 'tax', capex: 'capex', financing: 'fin_out' } as any)[kind] || 'op_cost';
    }
  }

  const tdsSection = sc.fss_category_tds_section?.code || match?.tdsSection || '';
  const sac = sc.sac_code || match?.sac || '';
  const itcBlocked = sc.input_gst_on_bills
    ? sc.input_gst_on_bills.toLowerCase().includes('blocked')
    : Boolean(match?.itcBlocked);

  return {
    id: localId,
    supabase_id: sc.id,
    name: sc.category_name,
    type,
    group,
    bucket,
    partyKind,
    kind,
    sac,
    itcBlocked,
    tdsSection,
    active: true,
    createdAt: sc.created_at || new Date().toISOString()
  };
}

// Convert Supabase fss_table_order_po rows into CRM order format
export function convertFssOrderToLocal(
  so: any,
  existingOrders: any[] = [],
  clients: any[] = [],
  projects: any[] = [],
  departments: any[] = []
) {
  const orderNum = (so.po_number || so.order_number || '').trim();
  const match = (existingOrders || []).find((o: any) =>
    (o.supabase_id && o.supabase_id === so.id) ||
    (o.orderNo && o.orderNo.trim().toLowerCase() === orderNum.toLowerCase())
  );
  const localId = match ? match.id : (so.id ? `ord_${so.id}` : `ord_${Date.now()}`);

  let type: 'PO' | 'LOI' | 'Email' | 'Contract' = match?.type || 'PO';
  const rawType = (so.order_type || '').toUpperCase();
  if (rawType === 'EMAIL' || orderNum.toLowerCase().startsWith('email')) type = 'Email';
  else if (rawType === 'CONTRACT' || orderNum.toLowerCase().startsWith('contract')) type = 'Contract';
  else if (rawType === 'LOI' || orderNum.toLowerCase().startsWith('loi')) type = 'LOI';
  else if (rawType === 'PO' || orderNum.toLowerCase().startsWith('po')) type = 'PO';

  // Details from child relation fss_table_order_details
  const det = Array.isArray(so.fss_table_order_details)
    ? so.fss_table_order_details[0]
    : (so.fss_table_order_details || {});

  // Departments from child relation fss_table_order_departments
  const rawDepts = so.fss_table_order_departments || so.departments || [];
  const dept0 = rawDepts[0] || {};

  const gstRate = Number(dept0.gst_rate ?? so.gst_rate ?? match?.gstRate ?? 18);

  let gstType: 'intra' | 'inter' | 'none' = 'intra';
  const rawGst = String(dept0.gst_type ?? so.gst_type ?? match?.gstType ?? '').toUpperCase();
  if (rawGst === 'IGST' || rawGst.includes('INTER')) gstType = 'inter';
  else if (rawGst === 'NONE' || gstRate === 0) gstType = 'none';
  else gstType = 'intra';

  let status: 'active' | 'closed' | 'cancelled' = 'active';
  const rawStatus = (so.status || '').toLowerCase();
  if (rawStatus === 'completed' || rawStatus === 'closed') status = 'closed';
  else if (rawStatus === 'cancelled') status = 'cancelled';
  else status = 'active';

  // Resolve clientId
  let clientId = match?.clientId || '';
  if (so.client_id) {
    const cMatch = (clients || []).find((c: any) => c.id === so.client_id || c.supabase_id === so.client_id);
    if (cMatch) clientId = cMatch.id;
    else if (!clientId) clientId = String(so.client_id);
  }
  if (!clientId && so.client_name) {
    const cMatch = (clients || []).find((c: any) => c.name && c.name.trim().toLowerCase() === so.client_name.trim().toLowerCase());
    if (cMatch) clientId = cMatch.id;
  }
  if (!clientId && (clients || []).length > 0) {
    clientId = clients[0].id;
  }

  // Resolve projectId
  let projectId = match?.projectId || '';
  if (so.project_id) {
    const pMatch = (projects || []).find((p: any) => p.id === so.project_id || p.supabase_id === so.project_id);
    if (pMatch) projectId = pMatch.id;
    else if (!projectId) projectId = String(so.project_id);
  }
  if (!projectId && so.project_name) {
    const pMatch = (projects || []).find((p: any) => p.name && p.name.trim().toLowerCase() === so.project_name.trim().toLowerCase());
    if (pMatch) projectId = pMatch.id;
  }

  // Pre-GST total and departments split
  const sumDeptAmt = rawDepts.reduce((sum: number, d: any) => sum + (Number(d.amount) || 0), 0);
  const totalTaxable = Number(dept0.order_value_pre_gst ?? so.pre_gst_amount) || sumDeptAmt || Number(match?.taxable) || 0;

  const split: any[] = [];
  rawDepts.forEach((d: any) => {
    const dName = (d.department_name || '').trim();
    const matchedDept = (departments || []).find((dept: any) =>
      (dept.name && dept.name.trim().toLowerCase() === dName.toLowerCase()) ||
      dept.id === dName
    );
    const depId = matchedDept ? matchedDept.id : (departments[0]?.id || 'dep_design');
    const amt = Number(d.amount) || 0;
    const existing = split.find(x => x.departmentId === depId);
    if (!existing) {
      const pct = totalTaxable > 0 ? (amt / totalTaxable) * 100 : 0;
      split.push({
        departmentId: depId,
        department_name: matchedDept ? matchedDept.name : dName,
        amount: amt,
        pct
      });
    }
  });

  const departmentId = split[0]?.departmentId || match?.departmentId || departments[0]?.id || 'dep_design';
  const finalSplit = split.length > 1 ? split : [];

  // Resolve milestones / payment terms
  const rawTerms = so.fss_table_order_payment_terms || so.fss_table_order_milestones || so.milestones || [];
  const sortedTerms = rawTerms.slice().sort((a: any, b: any) => (a.sequence_number || 0) - (b.sequence_number || 0));
  const terms = sortedTerms.map((m: any) => ({
    label: m.milestone_name || 'Milestone',
    milestone_name: m.milestone_name || 'Milestone',
    pct: Number(m.percentage) || 0,
    amount: Number(m.milestone_amount ?? m.amount) || 0,
    is_balance: Boolean(m.is_balance)
  }));

  // Resolve documents / attachments
  const rawDocs = so.fss_table_order_documents || so.documents || [];
  let attachments = rawDocs.map((doc: any) => ({
    id: doc.id,
    name: doc.file_name,
    path: doc.storage_path,
    type: doc.content_type || '',
    size: Number(doc.file_size_bytes) || 0
  }));

  if (attachments.length === 0 && (det.document_name || det.document_path || det.document_url)) {
    attachments = [{
      id: det.id,
      name: det.document_name || 'Attachment',
      path: det.document_path || det.document_url || '',
      url: det.document_url || ''
    }];
  }

  const totalAmount = Number(dept0.order_total_incl_gst ?? so.total_amount) || Math.round(totalTaxable + (totalTaxable * gstRate / 100));
  const gstAmount = Number(so.gst_amount) || Math.max(0, totalAmount - totalTaxable);

  return {
    id: localId,
    supabase_id: so.id,
    orderNo: orderNum,
    type,
    date: so.order_date || new Date().toISOString().split('T')[0],
    clientId,
    projectId,
    clientName: so.client_name || '',
    projectName: so.project_name || '',
    departmentId,
    split: split.length > 1 ? split : [],
    scope: so.scope || det.scope || '',
    taxable: totalTaxable,
    gstRate,
    gstType,
    gstAmount,
    total: totalAmount,
    terms: terms.length > 0 ? terms : [{ label: 'Full payment', pct: 100 }],
    expectedCompletion: so.expected_completion || det.expected_completion || '',
    contact: so.client_contact || det.client_contact || '',
    notes: so.notes || det.notes || '',
    attachments: attachments.length > 0 ? attachments : (match?.attachments || []),
    status,
    createdAt: so.created_at || new Date().toISOString(),
    updatedAt: so.updated_at || new Date().toISOString(),
    deleted: false
  };
}

// Convert Supabase fss_table_transactions rows into CRM entry format
export function convertFssTransactionToLocal(
  tx: any,
  existingEntries: any[] = [],
  parties: any[] = [],
  projects: any[] = [],
  departments: any[] = [],
  categories: any[] = [],
  accounts: any[] = []
) {
  const normMatchStr = (s: any) => String(s || '').trim().toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ');
  const match = (existingEntries || []).find((e: any) => {
    if (e.supabase_fss_transaction_id && e.supabase_fss_transaction_id === tx.id) return true;
    if (e.supabase_id && e.supabase_id === tx.id) return true;
    if (e.id === tx.id || e.id === `e_${tx.id}`) return true;
    const ref = tx.reference_number || tx.reference_no;
    if (ref && e.refNo && normMatchStr(e.refNo) === normMatchStr(ref)) return true;
    const dateMatch = e.date === (tx.transaction_date || tx.date);
    const typeMatch = String(e.type || '').toLowerCase() === String(tx.transaction_type || tx.type || '').toLowerCase();
    const amtMatch = Math.abs((Number(e.taxable) || Number(e.amount) || 0) - (Number(tx.taxable_amount ?? tx.taxable) || Number(tx.net_cash ?? tx.amount) || 0)) < 1;
    const eDesc = normMatchStr(e.description);
    const txDesc = normMatchStr(tx.description);
    const descMatch = Boolean(eDesc && txDesc && (eDesc === txDesc || eDesc.includes(txDesc) || txDesc.includes(eDesc)));
    return dateMatch && typeMatch && amtMatch && descMatch;
  });
  const localId = match ? match.id : (tx.id ? `e_${tx.id}` : `e_${Date.now()}`);

  const rawType = String(tx.transaction_type || tx.type || '').toLowerCase();
  const type: 'inflow' | 'outflow' | 'transfer' = rawType.includes('transfer')
    ? 'transfer'
    : rawType.includes('inflow') ? 'inflow' : 'outflow';

  // Resolve Party
  let partyId = match?.partyId || '';
  const partyNameStr = tx.party_name || tx.party || '';
  if (partyNameStr) {
    const pMatch = (parties || []).find((p: any) => p.name && p.name.trim().toLowerCase() === partyNameStr.trim().toLowerCase());
    if (pMatch) partyId = pMatch.id;
  }

  // Resolve Party Kind
  let partyKind = match?.partyKind || (type === 'inflow' ? 'client' : 'vendor');
  if (partyId) {
    const pMatch = (parties || []).find((p: any) => p.id === partyId);
    if (pMatch) partyKind = pMatch.kind;
  }

  // Resolve Project
  let projectId = match?.projectId || '';
  if (tx.project_code || tx.project_name || tx.project) {
    const prMatch = (projects || []).find((pr: any) =>
      (tx.project_code && pr.code && pr.code.trim().toLowerCase() === tx.project_code.trim().toLowerCase()) ||
      (tx.project_name && pr.name && pr.name.trim().toLowerCase() === tx.project_name.trim().toLowerCase()) ||
      (tx.project && pr.name && pr.name.trim().toLowerCase() === tx.project.trim().toLowerCase())
    );
    if (prMatch) projectId = prMatch.id;
  }

  // Resolve Department
  let departmentId = match?.departmentId || '';
  if (tx.department) {
    const dMatch = (departments || []).find((d: any) => d.name && d.name.trim().toLowerCase() === tx.department.trim().toLowerCase());
    if (dMatch) departmentId = dMatch.id;
  }
  if (!departmentId && (departments || []).length > 0) {
    departmentId = departments[0].id;
  }

  // Resolve Category
  const rawCat = String(tx.category || '').trim();
  const rawParty = String(partyNameStr).trim().toLowerCase();
  const rawDesc = String(tx.description || '').trim().toLowerCase();

  let categoryId = match?.categoryId || '';
  let categoryName = match?.categoryName || rawCat;

  // 1. Direct match with categories by ID or exact name
  if (rawCat) {
    const cMatch = (categories || []).find((c: any) =>
      c.id === rawCat ||
      (c.name && c.name.trim().toLowerCase() === rawCat.toLowerCase())
    );
    if (cMatch) {
      categoryId = cMatch.id;
      categoryName = cMatch.name;
    }
  }

  const normalizedRawCategory = rawCat.toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
  if (type === 'inflow' && /^project receipts?$/.test(normalizedRawCategory)) {
    const departmentName = String(tx.department || '').trim().toLowerCase();
    if (/engineering|engineer/.test(departmentName)) {
      categoryId = 'cat_reng';
      categoryName = categories.find((category: any) => category.id === categoryId)?.name || 'Project Receipts – Engineering';
    } else if (/design/.test(departmentName)) {
      categoryId = 'cat_rdesign';
      categoryName = categories.find((category: any) => category.id === categoryId)?.name || 'Project Receipts – Design';
    }
  }

  // 2. Keyword / semantic match on category, party, and description
  if (!categoryId) {
    const searchTarget = `${rawCat} ${rawParty} ${rawDesc}`.toLowerCase();

    if (type === 'outflow') {
      if (/clean|facility|housekeep/i.test(searchTarget)) {
        categoryId = 'cat_house';
        categoryName = categoryName || 'Housekeeping & Security';
      } else if (/pantry|supplies|welfare|food|coffee|brew/i.test(searchTarget)) {
        categoryId = 'cat_supplies';
        categoryName = categoryName || 'Office Supplies & Pantry';
      } else if (/internet|phone|fibernet|utility|broadband|airlink|wifi/i.test(searchTarget)) {
        categoryId = 'cat_net';
        categoryName = categoryName || 'Internet & Phone';
      } else if (/software|licen|cloudsuite|cloud|saas|subscription|tool/i.test(searchTarget)) {
        categoryId = 'cat_soft';
        categoryName = categoryName || 'Software Subscriptions';
      } else if (/freelanc|consult|ananya|ux|designer|developer|contractor/i.test(searchTarget)) {
        categoryId = 'cat_free';
        categoryName = categoryName || 'Freelancers & Consultants';
      } else if (/travel|convey|cab|uber|ola|flight|hotel/i.test(searchTarget)) {
        categoryId = 'cat_travel';
        categoryName = categoryName || 'Travel & Conveyance';
      } else if (/\bca\b|audit|accounting|chartered/i.test(searchTarget)) {
        categoryId = 'cat_ca';
        categoryName = categoryName || 'CA, Audit & Accounting';
      } else if (/legal|complian|advocate|lawyer/i.test(searchTarget)) {
        categoryId = 'cat_legal';
        categoryName = categoryName || 'Legal & Compliance';
      } else if (/bank\s*charge|bank\s*charges|charges/i.test(searchTarget)) {
        categoryId = 'cat_bank';
        categoryName = categoryName || 'Bank Charges';
      } else if (/salar|payroll|stipend|wages/i.test(searchTarget)) {
        categoryId = 'cat_sal';
        categoryName = categoryName || 'Salaries';
      } else if (/reimb/i.test(searchTarget)) {
        categoryId = 'cat_reimb';
        categoryName = categoryName || 'Employee Reimbursements';
      } else if (/rent/i.test(searchTarget)) {
        categoryId = 'cat_rent';
        categoryName = categoryName || 'Office Rent';
      } else if (/elec|power/i.test(searchTarget)) {
        categoryId = 'cat_elec';
        categoryName = categoryName || 'Electricity';
      } else if (/gst/i.test(searchTarget)) {
        categoryId = 'cat_gstpay';
        categoryName = categoryName || 'GST Paid to Govt';
      } else if (/tds/i.test(searchTarget)) {
        categoryId = 'cat_tdsdep';
        categoryName = categoryName || 'TDS Deposited';
      } else if (/emi|loan/i.test(searchTarget)) {
        categoryId = 'cat_emi';
        categoryName = categoryName || 'Loan EMI';
      } else {
        // Fallback: Check if party has a default category
        const pMatch = (parties || []).find((p: any) => p.name && p.name.trim().toLowerCase() === rawParty);
        if (pMatch?.defaultCategoryId) {
          categoryId = pMatch.defaultCategoryId;
          const matched = (categories || []).find((c: any) => c.id === categoryId);
          categoryName = categoryName || matched?.name || pMatch.name;
        } else {
          // Never blindly default to cat_sal! Use cat_vserv or a generic outflow category
          categoryId = 'cat_vserv';
          categoryName = categoryName || rawCat || 'Vendor Services (Project)';
        }
      }
    } else {
      // Inflow
      if (/design/i.test(searchTarget)) {
        categoryId = 'cat_rdesign';
        categoryName = categoryName || 'Project Receipts – Design';
      } else if (/eng/i.test(searchTarget)) {
        categoryId = 'cat_reng';
        categoryName = categoryName || 'Project Receipts – Engineering';
      } else if (/consult/i.test(searchTarget)) {
        categoryId = 'cat_consult';
        categoryName = categoryName || 'Consulting Fees';
      } else if (/interest|fd/i.test(searchTarget)) {
        categoryId = 'cat_fdint';
        categoryName = categoryName || 'FD / Bank Interest';
      } else {
        categoryId = 'cat_othinc';
        categoryName = categoryName || rawCat || 'Other Income';
      }
    }
  }

  if (!categoryName) {
    const cObj = (categories || []).find((c: any) => c.id === categoryId);
    categoryName = cObj?.name || rawCat || 'General Expense';
  }

  // Resolve Account
  let accountId = match?.accountId || '';
  const accountNameStr = tx.transfer_from_account_name || tx.account_name || tx.account || '';
  const fromAccount = (accounts || []).find((a: any) =>
    String(a.supabase_id || a.id) === String(tx.transfer_from_account_id || '') ||
    (accountNameStr && String(a.name || '').trim().toLowerCase() === accountNameStr.trim().toLowerCase())
  );
  const toAccount = (accounts || []).find((a: any) =>
    String(a.supabase_id || a.id) === String(tx.transfer_to_account_id || '') ||
    (tx.transfer_to_account_name && String(a.name || '').trim().toLowerCase() === String(tx.transfer_to_account_name).trim().toLowerCase())
  );
  if (type === 'transfer' && fromAccount) accountId = fromAccount.id;
  if (accountNameStr) {
    const aMatch = (accounts || []).find((a: any) => a.name && a.name.trim().toLowerCase() === accountNameStr.trim().toLowerCase());
    if (aMatch) accountId = aMatch.id;
  }
  if (!accountId && type !== 'transfer' && (accounts || []).length > 0) {
    accountId = accounts[0].id;
  }

  const taxable = Number(tx.taxable_amount ?? tx.taxable) || 0;
  const gstRate = Number(tx.gst_rate) || 0;
  const gstAmount = Number(tx.gst_amount ?? tx.gst) || 0;
  const tdsAmount = Number(tx.tds_amount ?? tx.tds) || 0;
  const netAmount = Math.abs(Number(tx.net_cash != null && tx.net_cash !== '' ? tx.net_cash : tx.amount)) || Math.abs(taxable + gstAmount - tdsAmount);
  const taxPeriodMatch = String(tx.description || '').match(/for (January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})/i);
  const taxPeriod = taxPeriodMatch
    ? `${taxPeriodMatch[2]}-${String(['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'].indexOf(taxPeriodMatch[1].toLowerCase()) + 1).padStart(2, '0')}`
    : undefined;

  return {
    id: localId,
    supabase_id: tx.id,
    supabase_fss_transaction_id: tx.id,
    type,
    date: tx.transaction_date || tx.date || new Date().toISOString().split('T')[0],
    categoryId,
    category: categoryName,
    categoryName,
    departmentId,
    partyKind,
    partyId: partyId || undefined,
    partyName: tx.party_name || tx.party || undefined,
    projectId: projectId || undefined,
    description: tx.description || '',
    taxPeriod: taxPeriod || match?.taxPeriod,
    refNo: tx.reference_number || tx.reference_no || '',
    taxable,
    gstType: (gstAmount > 0 ? 'intra' : 'none') as 'intra' | 'none',
    gstRate,
    gstAmount,
    itc: type === 'outflow' && gstAmount > 0,
    tdsRate: taxable > 0 && tdsAmount > 0 ? Math.round((tdsAmount / taxable) * 100) : 0,
    tdsAmount,
    amount: netAmount,
    paymentMode: tx.payment_mode || tx.mode || 'NEFT',
    accountId,
    accountName: type === 'transfer' ? (tx.transfer_from_account_name || tx.account_name || tx.account || undefined) : (tx.account_name || tx.account || undefined),
    toAccountId: type === 'transfer' ? (toAccount?.id || '') : undefined,
    transferFromAccountName: type === 'transfer' ? (tx.transfer_from_account_name || tx.account_name || undefined) : undefined,
    transferToAccountName: type === 'transfer' ? (tx.transfer_to_account_name || undefined) : undefined,
    notes: tx.notes || '',
    status: tx.status || 'Active',
    deleted: String(tx.status || '').toLowerCase().includes('cancel'),
    deletedAt: tx.transfer_deleted_at || (String(tx.status || '').toLowerCase().includes('cancel') ? tx.updated_at : null),
    deletedBy: tx.transfer_deleted_by || null,
    createdAt: tx.created_at || new Date().toISOString(),
    updatedAt: tx.updated_at || new Date().toISOString()
  };
}

export function deduplicateEntries(entries: any[]): any[] {
  const seenSupabaseIds = new Set<string>();
  const seenSignatures = new Set<string>();
  const norm = (s: any) => String(s || '').trim().toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ');

  // If there are Supabase-backed entries, discard any unbacked seed entries (like pi_*, rc_*, e_*)
  const hasSupabaseEntries = (entries || []).some((e: any) => Boolean(
    e.supabase_id || e.supabase_tax_statutory_id || e.supabase_other_expense_id ||
    e.supabase_client_payment_id || e.supabase_other_income_id || e.supabase_vendor_id ||
    e.supabase_employee_id
  ));

  const validEntries = hasSupabaseEntries
    ? (entries || []).filter((e: any) => Boolean(
        e.supabase_id || e.supabase_tax_statutory_id || e.supabase_other_expense_id ||
        e.supabase_client_payment_id || e.supabase_other_income_id || e.supabase_vendor_id ||
        e.supabase_employee_id || e.isUserCreated || e.deleted
      ))
    : (entries || []);

  // Sort so real Supabase entries (with supabase_id) come first, then latest by date
  const sorted = [...validEntries].sort((a, b) => {
    const aSb = a.supabase_id ? 1 : 0;
    const bSb = b.supabase_id ? 1 : 0;
    if (aSb !== bSb) return bSb - aSb;
    return (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '');
  });

  const result: any[] = [];
  for (const e of sorted) {
    if (e.deleted || String(e.status || '').toLowerCase().includes('cancel')) {
      const sbId = e.supabase_id ? String(e.supabase_id) : '';
      const localId = String(e.id || '');
      if ((sbId && seenSupabaseIds.has(sbId)) || (localId && seenSupabaseIds.has(localId))) continue;
      if (sbId) seenSupabaseIds.add(sbId);
      if (localId) seenSupabaseIds.add(localId);
      result.push(e);
      continue;
    }
    const sbId = e.supabase_id ? String(e.supabase_id) : '';
    if (sbId) {
      if (seenSupabaseIds.has(sbId)) continue;
      seenSupabaseIds.add(sbId);
    }
    const localId = String(e.id || '');
    if (localId && seenSupabaseIds.has(localId)) continue;

    const amt = Math.round((Number(e.taxable) || Number(e.amount) || 0) * 100);
    const netAmt = Math.round(Math.abs(Number(e.amount != null ? e.amount : e.netCash != null ? e.netCash : e.taxable || 0)) * 100);
    const date = String(e.date || '').slice(0, 10);
    const type = String(e.type || '').toLowerCase();
    const category = norm(e.categoryId || e.categoryName || e.category);
    const party = norm(e.partyId || e.partyName || e.party || e.party_name);
    const project = norm(e.projectId || e.projectCode || e.projectName || e.project);
    const account = norm(e.accountId || e.accountName || e.account_name || e.account);
    const toAccount = norm(e.toAccountId || e.transferToAccountName || e.toAccountName);
    const reference = norm(e.txnRef || e.refNo || e.reference_no || e.reference_number);
    const description = norm(e.description);
    const signature = type === 'inflow'
      ? `${date}|${type}|${amt}|${netAmt}|${party}|${account}|${reference}`
      : `${date}|${type}|${amt}|${netAmt}|${category}|${party}|${project}|${account}|${toAccount}|${reference}|${description}`;
    if (seenSignatures.has(signature)) {
      continue;
    }
    seenSignatures.add(signature);
    result.push(e);
  }
  return result;
}

function refreshCashflowEntriesFromStore() {
  if (!Store.data) return;
  Store.data.entries = deduplicateEntries(Store.data.entries || []);
  Store.data.cashflowEntries = Store.data.entries.filter((entry: any) =>
    !entry.deleted && !String(entry.status || '').toLowerCase().includes('cancel')
  );
}

function auditFailureMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  if (/row-level security policy/i.test(detail)) {
    return 'Supabase denied the audit write. Apply the fss_audit_insert_rpc migration in your Supabase project.';
  }
  if (/fss_insert_audit_log|could not find the function/i.test(detail)) {
    return 'The audit writer is not installed in Supabase yet. Apply the fss_audit_insert_rpc migration.';
  }
  return `The action was completed, but its audit log could not be saved: ${detail}`;
}

export const App: React.FC = () => {
  const [cloudStatus, setCloudStatus] = useState<CloudStatus>({
    configured: isSupabaseConfigured,
    connected: false,
    syncing: false,
    lastSynced: null,
    error: null,
    clientCount: 0,
    vendorCount: 0,
    employeeCount: 0,
    otherPartyCount: 0,
    projectCount: 0,
    departmentCount: 0,
    bankAccountCount: 0,
    categoryCount: 0,
    orderCount: 0,
    transactionCount: 0
  });
  const [showCloudModal, setShowCloudModal] = useState<boolean>(false);
  const [showAddClientModal, setShowAddClientModal] = useState<boolean>(false);
  const [showAddVendorModal, setShowAddVendorModal] = useState<boolean>(false);
  const [showAddEmployeeModal, setShowAddEmployeeModal] = useState<boolean>(false);
  const [showAddOtherPartyModal, setShowAddOtherPartyModal] = useState<boolean>(false);
  const [showAddProjectModal, setShowAddProjectModal] = useState<boolean>(false);
  const [showAddDepartmentModal, setShowAddDepartmentModal] = useState<boolean>(false);
  const [showAddBankAccountModal, setShowAddBankAccountModal] = useState<boolean>(false);
  const [showAddCategoryModal, setShowAddCategoryModal] = useState<boolean>(false);
  const [isFssTransactionModalOpen, setIsFssTransactionModalOpen] = useState<boolean>(false);
  const [fssTransactionToEdit, setFssTransactionToEdit] = useState<any | null>(null);
  const cashflowSummarySyncQueue = useRef<Promise<any[]>>(Promise.resolve([]));
  const isHydratingSupabase = useRef(false);

  const syncCashOutflowSummary = useCallback(async () => {
    const sync = async () => {
      if (!Store.data) throw new Error('Cashflow data is not loaded.');
      const { outflowRows: uiRows, statementRows } = getCashflowSummaryUiRows({ useStoredSummary: false });
      const uiRowsByName = new Map(uiRows.map(row => [String(row.category_name || '').trim().toLowerCase(), row]));
      const statementCategories = ['Operating costs', 'Project costs', 'Tax & statutory', 'Capex', 'Financing & owner'];
      const requiredMonths = CASH_OUTFLOW_MONTH_COLS.slice(3, 11);
      for (const category of statementCategories) {
        const row = uiRowsByName.get(category.toLowerCase());
        if (!row) {
          throw new Error(`Could not read "${category}" from the cash outflow statement; Supabase was not changed.`);
        }
        for (const month of requiredMonths) {
          if (
            !Object.prototype.hasOwnProperty.call(row, month)
            || row[month] === null
            || row[month] === undefined
            || row[month] === ''
            || !Number.isFinite(Number(row[month]))
          ) {
            throw new Error(`Could not read ${month} for "${category}" from the cash outflow statement; Supabase was not changed.`);
          }
        }
      }
      const cashflowStatementCategories = ['Opening Balance', 'Cash Inflow', 'Cash Outflow', 'Net Cash Flow', 'Closing Balance'];
      const statementRowsByName = new Map(statementRows.map(row => [String(row.category_name || '').trim().toLowerCase(), row]));
      for (const category of cashflowStatementCategories) {
        if (!statementRowsByName.has(category.toLowerCase())) {
          throw new Error(`Could not read "${category}" from the cashflow statement; Supabase was not changed.`);
        }
      }

      Store.data.fss_cash_flow_statement = await SupabaseService.syncCashflowStatementToSupabase(statementRows);
      const rows = buildCashOutflowSummaryRows(uiRows);
      const syncedRows = await SupabaseService.syncOperationCostToSupabase(rows);
      Store.data.fss_cash_outflow = syncedRows;
      return syncedRows;
    };
    const queuedSync = cashflowSummarySyncQueue.current.then(sync, sync);
    cashflowSummarySyncQueue.current = queuedSync;
    return queuedSync;
  }, []);

  // Callback after adding client via AddClientModal
  const handleClientAdded = useCallback((newClient: any) => {
    if (Store.data && Store.data.parties) {
      const partyRec = convertFssClientToParty(newClient, newClient.people || []);
      const existingIdx = Store.data.parties.findIndex((p: any) => p.id === newClient.id);
      const previous = existingIdx >= 0 ? { ...Store.data.parties[existingIdx] } : null;
      if (existingIdx >= 0) {
        Store.data.parties[existingIdx] = partyRec;
      } else {
        Store.data.parties.unshift(partyRec);
      }
      void recordSupabaseAudit(previous ? 'update' : 'create', 'parties', newClient.id, `${previous ? 'Updated' : 'Created'} client · ${partyRec.name}`, previous, partyRec);
      Store.persist();
      render({ keepScroll: true });
      setCloudStatus(prev => ({
        ...prev,
        clientCount: (prev.clientCount || 0) + 1,
        lastSynced: new Date().toLocaleTimeString()
      }));
    }
  }, []);

  // Callback after adding vendor via AddVendorModal
  const handleVendorAdded = useCallback((newVendor: any) => {
    if (Store.data && Store.data.parties) {
      const partyRec = convertFssVendorToParty(newVendor, newVendor.people || []);
      const existingIdx = Store.data.parties.findIndex((p: any) => p.id === newVendor.id);
      const previous = existingIdx >= 0 ? { ...Store.data.parties[existingIdx] } : null;
      if (existingIdx >= 0) {
        Store.data.parties[existingIdx] = partyRec;
      } else {
        Store.data.parties.unshift(partyRec);
      }
      void recordSupabaseAudit(previous ? 'update' : 'create', 'parties', newVendor.id, `${previous ? 'Updated' : 'Created'} vendor · ${partyRec.name}`, previous, partyRec);
      Store.persist();
      render({ keepScroll: true });
      setCloudStatus(prev => ({
        ...prev,
        vendorCount: (prev.vendorCount || 0) + 1,
        lastSynced: new Date().toLocaleTimeString()
      }));
    }
  }, []);

  // Callback after adding employee via AddEmployeeModal
  const handleEmployeeAdded = useCallback((newEmp: any) => {
    if (Store.data && Store.data.parties) {
      const partyRec = convertFssEmployeToParty(newEmp, Store.data.departments || []);
      const existingIdx = Store.data.parties.findIndex(
        (p: any) => p.supabase_id === newEmp.id || (p.kind === 'employee' && p.name.trim().toLowerCase() === newEmp.name.trim().toLowerCase())
      );
      const previous = existingIdx >= 0 ? { ...Store.data.parties[existingIdx] } : null;
      if (existingIdx >= 0) {
        Store.data.parties[existingIdx] = { ...Store.data.parties[existingIdx], ...partyRec };
      } else {
        Store.data.parties.unshift(partyRec);
      }
      void recordSupabaseAudit(previous ? 'update' : 'create', 'parties', newEmp.id, `${previous ? 'Updated' : 'Created'} employee · ${partyRec.name}`, previous, partyRec);
      Store.persist();
      render({ keepScroll: true });
      setCloudStatus(prev => ({
        ...prev,
        employeeCount: (prev.employeeCount || 0) + 1,
        lastSynced: new Date().toLocaleTimeString()
      }));
    }
  }, []);

  // Callback after adding other party via AddOtherPartyModal
  const handleOtherPartyAdded = useCallback((newOtherParty: any) => {
    if (Store.data && Store.data.parties) {
      const partyRec = convertFssOtherPartyToParty(newOtherParty);
      const existingIdx = Store.data.parties.findIndex(
        (p: any) => p.supabase_id === newOtherParty.id || (p.kind === 'other' && p.name.trim().toLowerCase() === newOtherParty.name.trim().toLowerCase())
      );
      const previous = existingIdx >= 0 ? { ...Store.data.parties[existingIdx] } : null;
      if (existingIdx >= 0) {
        Store.data.parties[existingIdx] = {
          ...Store.data.parties[existingIdx],
          ...partyRec,
          id: Store.data.parties[existingIdx].id // preserve local id (e.g. ot_hdfc)
        };
      } else {
        Store.data.parties.unshift(partyRec);
      }
      void recordSupabaseAudit(previous ? 'update' : 'create', 'parties', newOtherParty.id, `${previous ? 'Updated' : 'Created'} other party · ${partyRec.name}`, previous, partyRec);
      Store.persist();
      render({ keepScroll: true });
      setCloudStatus(prev => ({
        ...prev,
        otherPartyCount: (prev.otherPartyCount || 0) + 1,
        lastSynced: new Date().toLocaleTimeString()
      }));
    }
  }, []);

  // Callback after adding project via AddProjectModal
  const handleProjectAdded = useCallback((newProject: any) => {
    if (Store.data && Store.data.projects) {
      const projRec = convertFssProjectToLocal(newProject, Store.data.parties || [], Store.data.departments || []);
      const existingIdx = Store.data.projects.findIndex(
        (p: any) => p.supabase_id === newProject.id || (p.code && p.code.trim().toLowerCase() === newProject.project_code.trim().toLowerCase())
      );
      const previous = existingIdx >= 0 ? { ...Store.data.projects[existingIdx] } : null;
      if (existingIdx >= 0) {
        Store.data.projects[existingIdx] = {
          ...Store.data.projects[existingIdx],
          ...projRec,
          id: Store.data.projects[existingIdx].id // preserve local id
        };
      } else {
        Store.data.projects.unshift(projRec);
      }
      void recordSupabaseAudit(previous ? 'update' : 'create', 'projects', newProject.id, `${previous ? 'Updated' : 'Created'} project · ${projRec.name}`, previous, projRec);
      Store.persist();
      render({ keepScroll: true });
      setCloudStatus(prev => ({
        ...prev,
        projectCount: (prev.projectCount || 0) + 1,
        lastSynced: new Date().toLocaleTimeString()
      }));
    }
  }, []);

  // Callback after adding department via AddDepartmentModal
  const handleDepartmentAdded = useCallback((newDept: any) => {
    if (Store.data && Store.data.departments) {
      const deptRec = convertFssDepartmentToLocal(newDept);
      const existingIdx = Store.data.departments.findIndex(
        (d: any) => d.supabase_id === newDept.id || (d.name && d.name.trim().toLowerCase() === newDept.department_name.trim().toLowerCase())
      );
      const previous = existingIdx >= 0 ? { ...Store.data.departments[existingIdx] } : null;
      if (existingIdx >= 0) {
        Store.data.departments[existingIdx] = {
          ...Store.data.departments[existingIdx],
          ...deptRec,
          id: Store.data.departments[existingIdx].id // preserve local id
        };
      } else {
        Store.data.departments.push(deptRec);
      }
      void recordSupabaseAudit(previous ? 'update' : 'create', 'departments', newDept.id, `${previous ? 'Updated' : 'Created'} department · ${deptRec.name}`, previous, deptRec);
      Store.persist();
      render({ keepScroll: true });
      setCloudStatus(prev => ({
        ...prev,
        departmentCount: (prev.departmentCount || 0) + 1,
        lastSynced: new Date().toLocaleTimeString()
      }));
    }
  }, []);

  // Callback after adding bank account via AddBankAccountModal
  const handleBankAccountAdded = useCallback((newAcc: any) => {
    if (Store.data && Store.data.accounts) {
      const accRec = convertFssBankAccountToLocal(newAcc);
      const existingIdx = Store.data.accounts.findIndex(
        (a: any) => (a.supabase_id && a.supabase_id === newAcc.id) ||
                    (a.name && a.name.trim().toLowerCase() === newAcc.account_name.trim().toLowerCase())
      );
      const previous = existingIdx >= 0 ? { ...Store.data.accounts[existingIdx] } : null;
      if (existingIdx >= 0) {
        Store.data.accounts[existingIdx] = {
          ...Store.data.accounts[existingIdx],
          ...accRec,
          id: Store.data.accounts[existingIdx].id // preserve local id (e.g. acc_hdfc)
        };
      } else {
        Store.data.accounts.push(accRec);
      }
      void recordSupabaseAudit(previous ? 'update' : 'create', 'accounts', newAcc.id, `${previous ? 'Updated' : 'Created'} bank account · ${accRec.name}`, previous, accRec);
      Store.persist();
      render({ keepScroll: true });
      setCloudStatus(prev => ({
        ...prev,
        bankAccountCount: (prev.bankAccountCount || 0) + 1,
        lastSynced: new Date().toLocaleTimeString()
      }));
    }
  }, []);

  // Callback after adding category via AddCategoryModal
  const handleCategoryAdded = useCallback((newCat: any) => {
    if (Store.data && Store.data.categories) {
      const catRec = convertFssCategoryToLocal(newCat, Store.data.categories);
      const existingIdx = Store.data.categories.findIndex(
        (c: any) => (c.supabase_id && c.supabase_id === newCat.id) ||
                    (c.name && c.name.trim().toLowerCase() === (newCat.category_name || '').trim().toLowerCase())
      );
      const previous = existingIdx >= 0 ? { ...Store.data.categories[existingIdx] } : null;
      if (existingIdx >= 0) {
        Store.data.categories[existingIdx] = {
          ...Store.data.categories[existingIdx],
          ...catRec,
          id: Store.data.categories[existingIdx].id // preserve local id (e.g. cat_sal)
        };
      } else {
        Store.data.categories.push(catRec);
      }
      void recordSupabaseAudit(previous ? 'update' : 'create', 'categories', newCat.id, `${previous ? 'Updated' : 'Created'} category · ${catRec.name}`, previous, catRec);
      Store.persist();
      render({ keepScroll: true });
      setCloudStatus(prev => ({
        ...prev,
        categoryCount: (prev.categoryCount || 0) + 1,
        lastSynced: new Date().toLocaleTimeString()
      }));
    }
  }, []);

  // Hydrate clients from Supabase fss_client
  const loadSupabaseClients = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    try {
      setCloudStatus(prev => ({ ...prev, syncing: true, error: null }));
      const supabaseClients = await SupabaseService.loadClientsFromSupabase();

      if (supabaseClients && Store.data?.parties) {
        const localClients = Store.data.parties.filter((party: any) => party.kind === 'client');
        const cloudClients = replaceMasterRows(
          localClients,
          supabaseClients,
          (client: any) => convertFssClientToParty(client, client.people),
          (local: any, remote: any) => local.supabase_id === remote.id ||
            local.id === remote.id ||
            String(local.name || '').trim().toLowerCase() === String(remote.client_name || '').trim().toLowerCase()
        );
        Store.data.parties = [...Store.data.parties.filter((party: any) => party.kind !== 'client'), ...cloudClients];
        Store.persist();
        render({ keepScroll: true });
      }

      setCloudStatus(prev => ({
        ...prev,
        connected: true,
        syncing: false,
        clientCount: supabaseClients.length,
        lastSynced: new Date().toLocaleTimeString(),
        error: null
      }));
    } catch (err: any) {
      console.error('Error syncing Supabase clients:', err);
      setCloudStatus(prev => ({
        ...prev,
        syncing: false,
        error: err.message || 'Error connecting to fss_client table'
      }));
    }
  }, []);

  // Hydrate vendors from Supabase fss_vendor
  const loadSupabaseVendors = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    try {
      setCloudStatus(prev => ({ ...prev, syncing: true, error: null }));
      const supabaseVendors = await SupabaseService.loadVendorsFromSupabase();

      if (supabaseVendors && Store.data?.parties) {
        const localVendors = Store.data.parties.filter((party: any) => party.kind === 'vendor');
        const cloudVendors = replaceMasterRows(
          localVendors,
          supabaseVendors,
          (vendor: any) => convertFssVendorToParty(vendor, vendor.people),
          (local: any, remote: any) => local.supabase_id === remote.id ||
            local.id === remote.id ||
            String(local.name || '').trim().toLowerCase() === String(remote.vendor_name || '').trim().toLowerCase()
        );
        Store.data.parties = [...Store.data.parties.filter((party: any) => party.kind !== 'vendor'), ...cloudVendors];
        Store.persist();
        render({ keepScroll: true });
      }

      setCloudStatus(prev => ({
        ...prev,
        connected: true,
        syncing: false,
        vendorCount: supabaseVendors.length,
        lastSynced: new Date().toLocaleTimeString(),
        error: null
      }));
    } catch (err: any) {
      console.error('Error syncing Supabase vendors:', err);
      setCloudStatus(prev => ({
        ...prev,
        syncing: false,
        error: err.message || 'Error connecting to fss_vendor table'
      }));
    }
  }, []);

  // Hydrate employees from Supabase fss_employe
  const loadSupabaseEmployees = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    try {
      setCloudStatus(prev => ({ ...prev, syncing: true, error: null }));
      const supabaseEmployees = await SupabaseService.loadEmployeesFromSupabase();

      if (supabaseEmployees && Store.data?.parties) {
        const localEmployees = Store.data.parties.filter((party: any) => party.kind === 'employee');
        const cloudEmployees = replaceMasterRows(
          localEmployees,
          supabaseEmployees,
          (employee: any) => convertFssEmployeToParty(employee, Store.data.departments || []),
          (local: any, remote: any) => local.supabase_id === remote.id ||
            local.id === String(remote.id) ||
            String(local.name || '').trim().toLowerCase() === String(remote.name || '').trim().toLowerCase()
        );
        Store.data.parties = [...Store.data.parties.filter((party: any) => party.kind !== 'employee'), ...cloudEmployees];
        Store.persist();
        render({ keepScroll: true });
      }

      setCloudStatus(prev => ({
        ...prev,
        connected: true,
        syncing: false,
        employeeCount: supabaseEmployees.length,
        lastSynced: new Date().toLocaleTimeString(),
        error: null
      }));
    } catch (err: any) {
      console.error('Error syncing Supabase employees:', err);
      setCloudStatus(prev => ({
        ...prev,
        syncing: false,
        error: err.message || 'Error connecting to fss_employe table'
      }));
    }
  }, []);

  // Hydrate other parties from Supabase fss_other_parties
  const loadSupabaseOtherParties = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    try {
      setCloudStatus(prev => ({ ...prev, syncing: true, error: null }));
      const supabaseOtherParties = await SupabaseService.loadOtherPartiesFromSupabase();

      if (supabaseOtherParties && Store.data?.parties) {
        const localOtherParties = Store.data.parties.filter((party: any) => party.kind === 'other');
        const cloudOtherParties = replaceMasterRows(
          localOtherParties,
          supabaseOtherParties,
          convertFssOtherPartyToParty,
          (local: any, remote: any) => local.supabase_id === remote.id ||
            local.id === String(remote.id) ||
            String(local.name || '').trim().toLowerCase() === String(remote.name || '').trim().toLowerCase()
        );
        Store.data.parties = [...Store.data.parties.filter((party: any) => party.kind !== 'other'), ...cloudOtherParties];
        Store.persist();
        render({ keepScroll: true });
      }

      setCloudStatus(prev => ({
        ...prev,
        connected: true,
        syncing: false,
        otherPartyCount: supabaseOtherParties.length,
        lastSynced: new Date().toLocaleTimeString(),
        error: null
      }));
    } catch (err: any) {
      console.error('Error syncing Supabase other parties:', err);
      setCloudStatus(prev => ({
        ...prev,
        syncing: false,
        error: err.message || 'Error connecting to fss_other_parties table'
      }));
    }
  }, []);

  // Hydrate projects from Supabase fss_projects
  const loadSupabaseProjects = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    try {
      setCloudStatus(prev => ({ ...prev, syncing: true, error: null }));
      const supabaseProjects = await SupabaseService.loadProjectsFromSupabase();

      if (supabaseProjects && Store.data?.projects) {
        Store.data.projects = replaceMasterRows(
          Store.data.projects,
          supabaseProjects,
          (project: any) => convertFssProjectToLocal(project, Store.data.parties || [], Store.data.departments || []),
          (local: any, remote: any) => local.supabase_id === remote.id ||
            String(local.code || local.project_code || '').trim().toLowerCase() ===
              String(remote.project_code || '').trim().toLowerCase()
        );
        Store.persist();
        render({ keepScroll: true });
      }

      setCloudStatus(prev => ({
        ...prev,
        connected: true,
        syncing: false,
        projectCount: supabaseProjects.length,
        lastSynced: new Date().toLocaleTimeString(),
        error: null
      }));
    } catch (err: any) {
      console.error('Error syncing Supabase projects:', err);
      setCloudStatus(prev => ({
        ...prev,
        syncing: false,
        error: err.message || 'Error connecting to fss_projects table'
      }));
    }
  }, []);

  // Hydrate departments from Supabase fss_departments
  const loadSupabaseDepartments = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    try {
      setCloudStatus(prev => ({ ...prev, syncing: true, error: null }));
      const supabaseDepts = await SupabaseService.loadDepartmentsFromSupabase();

      if (supabaseDepts && Store.data?.departments) {
        Store.data.departments = replaceMasterRows(
          Store.data.departments,
          supabaseDepts,
          convertFssDepartmentToLocal,
          (local: any, remote: any) => local.supabase_id === remote.id ||
            local.id === String(remote.id) ||
            String(local.name || '').trim().toLowerCase() === String(remote.department_name || '').trim().toLowerCase()
        );
        Store.persist();
        render({ keepScroll: true });
      }

      setCloudStatus(prev => ({
        ...prev,
        connected: true,
        syncing: false,
        departmentCount: supabaseDepts.length,
        lastSynced: new Date().toLocaleTimeString(),
        error: null
      }));
    } catch (err: any) {
      console.error('Error syncing Supabase departments:', err);
      setCloudStatus(prev => ({
        ...prev,
        syncing: false,
        error: err.message || 'Error connecting to fss_departments table'
      }));
    }
  }, []);

  // Hydrate bank accounts from Supabase fss_bank_accounts
  const loadSupabaseBankAccounts = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    try {
      setCloudStatus(prev => ({ ...prev, syncing: true, error: null }));
      const supabaseAccounts = await SupabaseService.loadBankAccountsFromSupabase();

      if (supabaseAccounts && Store.data?.accounts) {
        Store.data.accounts = replaceMasterRows(
          Store.data.accounts,
          supabaseAccounts,
          convertFssBankAccountToLocal,
          (local: any, remote: any) => local.supabase_id === remote.id ||
            local.id === String(remote.id) ||
            String(local.name || '').trim().toLowerCase() === String(remote.account_name || '').trim().toLowerCase()
        );
        Store.persist();
        render({ keepScroll: true });
        void syncCreditedDebitedFromEntries(Store.data?.entries || []);
      }

      setCloudStatus(prev => ({
        ...prev,
        connected: true,
        syncing: false,
        bankAccountCount: supabaseAccounts.length,
        lastSynced: new Date().toLocaleTimeString(),
        error: null
      }));
    } catch (err: any) {
      console.error('Error syncing Supabase bank accounts:', err);
      setCloudStatus(prev => ({
        ...prev,
        syncing: false,
        error: err.message || 'Error connecting to fss_bank_accounts table'
      }));
    }
  }, []);

  // Hydrate categories from Supabase fss_categories
  const loadSupabaseCategories = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    try {
      setCloudStatus(prev => ({ ...prev, syncing: true, error: null }));
      await SupabaseService.loadCategoryLookups();
      const supabaseCategories = await SupabaseService.loadCategoriesFromSupabase();

      if (supabaseCategories && Store.data?.categories) {
        const localCategories = Store.data.categories;
        Store.data.categories = replaceMasterRows(
          localCategories,
          supabaseCategories,
          (category: any) => convertFssCategoryToLocal(category, localCategories),
          (local: any, remote: any) => local.supabase_id === remote.id ||
            String(local.name || '').trim().toLowerCase() === String(remote.category_name || '').trim().toLowerCase()
        );
        Store.persist();
        render({ keepScroll: true });
      }

      setCloudStatus(prev => ({
        ...prev,
        connected: true,
        syncing: false,
        categoryCount: supabaseCategories.length,
        lastSynced: new Date().toLocaleTimeString(),
        error: null
      }));
    } catch (err: any) {
      console.error('Error syncing Supabase categories:', err);
      setCloudStatus(prev => ({
        ...prev,
        syncing: false,
        error: err.message || 'Error connecting to fss_categories table'
      }));
    }
  }, []);

  // Hydrate orders from Supabase fss_table_orders
  const loadSupabaseOrders = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    try {
      setCloudStatus(prev => ({ ...prev, syncing: true, error: null }));
      let supabaseOrders = await SupabaseService.loadOrdersFromSupabase();

      // If fss_table_orders is empty in Supabase, auto-seed with local active orders
      if (supabaseOrders.length === 0 && Store.data?.orders) {
        const validOrders = Store.data.orders.filter((o: any) => o.orderNo && !o.deleted);
        if (validOrders.length > 0) {
          console.log('fss_table_orders table is empty in Supabase. Syncing existing orders to Supabase...');
          await SupabaseService.syncLocalOrdersToSupabase(
            Store.data.orders,
            Store.data.parties || [],
            Store.data.projects || [],
            Store.data.departments || []
          );
          supabaseOrders = await SupabaseService.loadOrdersFromSupabase();
        }
      }

      if (supabaseOrders && Store.data?.orders) {
        supabaseOrders.forEach((so: any) => {
          const ordRecord = convertFssOrderToLocal(
            so,
            Store.data.orders,
            Store.data.parties || [],
            Store.data.projects || [],
            Store.data.departments || []
          );
          const ordNum = (so.po_number || so.order_number || '').trim().toLowerCase();
          const existingIdx = Store.data.orders.findIndex(
            (o: any) => (o.supabase_id && o.supabase_id === so.id) ||
                        (o.orderNo && o.orderNo.trim().toLowerCase() === ordNum)
          );
          if (existingIdx >= 0) {
            Store.data.orders[existingIdx] = {
              ...Store.data.orders[existingIdx],
              ...ordRecord,
              id: Store.data.orders[existingIdx].id // preserve local id (e.g. ord_1)
            };
          } else {
            Store.data.orders.unshift(ordRecord);
          }
        });
        Store.persist();
        render({ keepScroll: true });
      }

      setCloudStatus(prev => ({
        ...prev,
        connected: true,
        syncing: false,
        orderCount: supabaseOrders.length,
        lastSynced: new Date().toLocaleTimeString(),
        error: null
      }));
    } catch (err: any) {
      console.error('Error syncing Supabase orders:', err);
      setCloudStatus(prev => ({
        ...prev,
        syncing: false,
        error: err.message || 'Error connecting to fss_table_orders table'
      }));
    }
  }, []);

  // Hydrate transactions from Supabase fss_table_transactions
  const loadSupabaseTransactions = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    let payVendorAttachmentLoadError: string | null = null;
    const deletedEntrySnapshots = (Store.data?.entries || [])
      .filter((entry: any) => entry.deleted)
      .map((entry: any) => ({ ...entry }));
    try {
      setCloudStatus(prev => ({ ...prev, syncing: true, error: null }));
      const [supabaseTransactions, cancelledTransactions] = await Promise.all([
        SupabaseService.loadTransactionsFromSupabase(),
        SupabaseService.loadCancelledTransactionsFromSupabase()
      ]);

      // Keep an account-scoped authoritative copy for balance calculations.
      // The ledger already uses this filtered Supabase path; using it here
      // prevents stale local rows from changing Balance today.
      try {
        const openingDate = Store.data.settings?.openingDate || '1900-01-01';
        const accountRows = await Promise.all((Store.data.accounts || []).map((account: any) =>
          SupabaseService.queryFssTransactions({
            account: account.name,
            from: openingDate,
            to: '9999-12-31'
          })
        ));
        const authoritativeRows = accountRows.flat();
        const seen = new Set<string>();
        const normalizeTransactionPart = (value: any) =>
          String(value ?? '').trim().toLowerCase().replace(/[â€“â€”]/g, '-').replace(/\s+/g, ' ');
        Store.data.authoritativeAccountTransactions = authoritativeRows.filter((row: any) => {
          const type = normalizeTransactionPart(row.transaction_type || row.type);
          const amount = Math.abs(Number(row.net_cash ?? row.amount ?? row.taxable_amount) || 0).toFixed(2);
          const baseKey = [
            normalizeTransactionPart(row.transaction_date || row.date),
            type,
            amount,
            normalizeTransactionPart(row.reference_number || row.reference_no),
            normalizeTransactionPart(row.party_name || row.party),
            normalizeTransactionPart(row.account_name || row.account),
            normalizeTransactionPart(row.transfer_from_account_name),
            normalizeTransactionPart(row.transfer_to_account_name)
          ].join('|');
          // Receipt and import rows can use different labels for the same
          // bank movement. Match inflows by their bank identity fields.
          const key = type === 'inflow'
            ? `inflow|${baseKey}`
            : `${baseKey}|${normalizeTransactionPart(row.category)}|${normalizeTransactionPart(row.description)}|${normalizeTransactionPart(row.project_name || row.project)}|${normalizeTransactionPart(row.department)}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      } catch (accountLoadError) {
        console.warn('Could not load account-scoped transactions for balances:', accountLoadError);
        Store.data.authoritativeAccountTransactions = [];
      }

      if (supabaseTransactions && Store.data?.entries) {
        const transactionIds = new Set(supabaseTransactions.map((transaction: any) => String(transaction.id)));
        Store.data.supabaseTransactionIds = [...transactionIds];
        Store.data.entries = Store.data.entries.filter((entry: any) => {
          const entryId = String(entry.id || '');
          const transactionId = String(entry.supabase_id || entryId.replace(/^e_/, ''));
          const hasTransactionId = Boolean(entry.supabase_id || entryId.startsWith('e_') || transactionIds.has(entryId));
          const isFormBacked = Boolean(
            entry.supabase_tax_statutory_id ||
            entry.supabase_other_expense_id ||
            entry.supabase_client_payment_id ||
            entry.supabase_other_income_id ||
            entry.supabase_vendor_id ||
            entry.supabase_employee_id ||
            entry.supabase_pay_vendor_id ||
            entry.supabase_pay_employee_id
          );
          if (hasTransactionId) return transactionIds.has(transactionId) || isFormBacked;
          return isFormBacked || entry.isUserCreated;
        });
        supabaseTransactions.forEach((st: any) => {
          // A Supabase row has a stable ID. Passing every local row here lets
          // convertFssTransactionToLocal match an unrelated legacy row that
          // happens to have the same date, type, amount, and description.
          // That is especially dangerous for transfers and account-specific
          // inflows. Hydrate by cloud identity; unsynced local rows are kept
          // by the cleanup above and are not candidates for a cloud row.
          const matchingCloudEntries = Store.data.entries.filter((entry: any) =>
            String(entry.supabase_id || '') === String(st.id)
          );
          const entryRecord = convertFssTransactionToLocal(
            st,
            matchingCloudEntries,
            Store.data.parties || [],
            Store.data.projects || [],
            Store.data.departments || [],
            Store.data.categories || [],
            Store.data.accounts || []
          );
          const normStr = (s: any) => String(s || '').trim().toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ');
          const sameTransferAccounts = (candidate: any) => {
            if (String(st.transaction_type || '').toLowerCase() !== 'transfer') return true;
            return String(candidate.accountId || '') === String(entryRecord.accountId || '') &&
              String(candidate.toAccountId || '') === String(entryRecord.toAccountId || '');
          };
          const existingIdx = Store.data.entries.findIndex(
            (e: any) => (e.supabase_id && e.supabase_id === st.id) ||
                        (e.id === st.id || e.id === `e_${st.id}`) ||
                        (st.reference_number && e.refNo && normStr(e.refNo) === normStr(st.reference_number)) ||
                        (e.date === st.transaction_date &&
                         String(e.type || '').toLowerCase() === String(st.transaction_type || '').toLowerCase() &&
                         sameTransferAccounts(e) &&
                         Math.abs((Number(e.taxable) || Number(e.amount) || 0) - (Number(st.taxable_amount) || Number(st.net_cash) || 0)) < 1 &&
                         Boolean(normStr(e.description) && normStr(st.description) &&
                         (normStr(e.description) === normStr(st.description) || normStr(e.description).includes(normStr(st.description)) || normStr(st.description).includes(normStr(e.description)))))
          );
          if (existingIdx >= 0) {
            Store.data.entries[existingIdx] = {
              ...Store.data.entries[existingIdx],
              ...entryRecord,
              id: Store.data.entries[existingIdx].id,
              supabase_id: st.id
            };
          } else {
            Store.data.entries.unshift(entryRecord);
          }
        });

        // Cancelled transactions are the cloud-backed source for Trash. If the
        // local tombstone is missing (for example after clearing browser data),
        // rebuild it from the cancelled Supabase row instead of dropping it.
        for (const cancelledTransaction of cancelledTransactions || []) {
          const transactionId = String(cancelledTransaction.id || '');
          const existingDeletedEntry = Store.data.entries.find((entry: any) =>
            String(entry.supabase_id || '') === transactionId ||
            String(entry.id || '') === transactionId ||
            String(entry.id || '') === `e_${transactionId}`
          );
          if (existingDeletedEntry) {
            existingDeletedEntry.deleted = true;
            existingDeletedEntry.deletedAt = existingDeletedEntry.deletedAt || cancelledTransaction.updated_at || new Date().toISOString();
            existingDeletedEntry.deletedBy = existingDeletedEntry.deletedBy || cancelledTransaction.deleted_by || null;
            continue;
          }
          const deletedEntry = convertFssTransactionToLocal(
            cancelledTransaction,
            Store.data.entries,
            Store.data.parties || [],
            Store.data.projects || [],
            Store.data.departments || [],
            Store.data.categories || [],
            Store.data.accounts || []
          );
          Store.data.entries.push({
            ...deletedEntry,
            supabase_id: cancelledTransaction.id,
            deleted: true,
            deletedAt: cancelledTransaction.updated_at || new Date().toISOString(),
            deletedBy: cancelledTransaction.deleted_by || null
          });
        }

        // The dedicated Tax & Statutory table is the source for tax-payment form rows.
        // Hydrate those rows into the existing entry model so the current UI remains unchanged.
        if (typeof (window as any).__supabaseLoadTaxStatutoryEntries === 'function') {
          const taxRows = await (window as any).__supabaseLoadTaxStatutoryEntries();
          const taxIds = new Set((taxRows || []).map((row: any) => String(row.id)));
          Store.data.entries = Store.data.entries.filter((e: any) =>
            !e.supabase_tax_statutory_id || taxIds.has(String(e.supabase_tax_statutory_id))
          );
          const taxCategoryId = (type: string) => {
            const wanted = type === 'GST' ? 'cat_gstpay'
              : type === 'TDS' ? 'cat_tdsdep'
                : type === 'Professional tax' ? 'cat_ptax' : 'cat_advtax';
            return Store.data?.categories?.some((c: any) => c.id === wanted)
              ? wanted
              : Store.data?.categories?.find((c: any) => c.type === 'outflow' && /tax|gst|tds/i.test(c.name))?.id || wanted;
          };
          for (const row of taxRows || []) {
            const party = Store.data.parties.find((p: any) => String(p.name || '').trim().toLowerCase() === String(row.party || '').trim().toLowerCase());
            const department = Store.data.departments.find((d: any) => String(d.name || '').trim().toLowerCase() === String(row.department || '').trim().toLowerCase());
            const account = Store.data.accounts.find((a: any) => String(a.name || '').trim().toLowerCase() === String(row.paid_from || '').trim().toLowerCase());
            const entryRecord: any = {
              id: `tax_${row.id}`,
              type: 'outflow',
              date: row.payment_date,
              categoryId: taxCategoryId(row.paying_type),
              departmentId: department?.id || '',
              partyKind: 'other',
              partyId: party?.id || (row.paying_type === 'GST' ? 'ot_gst' : 'ot_it'),
              projectId: '',
              description: row.description || '',
              refNo: row.challan_no || '',
              taxable: Number(row.amount_paid) || 0,
              gstType: 'none',
              gstRate: 0,
              gstAmount: 0,
              itc: false,
              tdsRate: 0,
              tdsAmount: 0,
              amount: Number(row.amount_paid) || 0,
              paymentMode: row.payment_mode || '',
              accountId: account?.id || '',
              txnRef: row.utr_cheque_ref || '',
              notes: row.notes || '',
              attachments: formAttachmentsFromValue(row.attachment_url, 'tax_saturatory', `tax_attachment_${row.id}`),
              taxPeriod: row.tax_month ? String(row.tax_month).slice(0, 7) : undefined,
              supabase_tax_statutory_id: row.id,
              deleted: false,
              createdAt: row.created_at || new Date().toISOString(),
              updatedAt: row.updated_at || row.created_at || new Date().toISOString()
            };
            const existingIdx = Store.data.entries.findIndex((e: any) =>
              e.supabase_tax_statutory_id === row.id ||
              (e.type === 'outflow' && ['cat_gstpay', 'cat_tdsdep', 'cat_ptax', 'cat_advtax'].includes(e.categoryId) && e.date === entryRecord.date && e.refNo === entryRecord.refNo && e.categoryId === entryRecord.categoryId)
            );
            if (existingIdx >= 0) {
              Store.data.entries[existingIdx] = { ...Store.data.entries[existingIdx], ...entryRecord, id: Store.data.entries[existingIdx].id };
            } else {
              Store.data.entries.unshift(entryRecord);
            }
          }
        }
        if (typeof (window as any).__supabaseLoadPayEmployeeEntries === 'function') {
          const employeeRows = await (window as any).__supabaseLoadPayEmployeeEntries();
          const employeeIds = new Set((employeeRows || []).map((row: any) => String(row.id)));
          Store.data.entries = Store.data.entries.filter((entry: any) =>
            !entry.supabase_pay_employee_id || employeeIds.has(String(entry.supabase_pay_employee_id))
          );
          const normalize = (value: any) => String(value || '').trim().toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ');
          for (const row of employeeRows || []) {
            const employeeName = normalize(row.employee_name);
            const accountName = normalize(row.paid_from);
            const reference = normalize(row.reference_no || row.utr_cheque_ref);
            const amount = Math.abs(Number(row.amount) || 0);
            const matchingEntries = Store.data.entries.filter((entry: any) => {
              if (entry.type !== 'outflow' || String(entry.date || '').slice(0, 10) !== String(row.payment_date || '').slice(0, 10)) return false;
              const entryParty = normalize(entry.partyName || api.get('parties', entry.partyId)?.name);
              const entryAccount = normalize(entry.accountName || api.get('accounts', entry.accountId)?.name);
              if (entryParty !== employeeName || (accountName && entryAccount !== accountName)) return false;
              if (reference && normalize(entry.refNo || entry.txnRef) !== reference) return false;
              return Math.abs(Math.abs(Number(entry.amount) || 0) - amount) < 0.01;
            });
            const entry = Store.data.entries.find((candidate: any) =>
              String(candidate.supabase_pay_employee_id || '') === String(row.id)
            ) || (matchingEntries.length === 1 ? matchingEntries[0] : null);
            if (!entry) continue;
            entry.supabase_pay_employee_id = row.id;
            entry.attachments = formAttachmentsFromValue(
              row.attachment_url,
              'pay an employee attachment',
              `employee_attachment_${row.id}`
            );
          }
        }
        if (typeof (window as any).__supabaseLoadOtherExpenseEntries === 'function') {
          const rows = await (window as any).__supabaseLoadOtherExpenseEntries();
          const ids = new Set((rows || []).map((row: any) => String(row.id)));
          Store.data.entries = Store.data.entries.filter((e: any) => !e.supabase_other_expense_id || ids.has(String(e.supabase_other_expense_id)));
          for (const row of rows || []) {
            const category = Store.data.categories.find((c: any) => String(c.name || '').trim().toLowerCase() === String(row.expense_category || '').trim().toLowerCase());
            const party = Store.data.parties.find((p: any) => String(p.name || '').trim().toLowerCase() === String(row.paid_to || '').trim().toLowerCase());
            const department = Store.data.departments.find((d: any) => String(d.name || '').trim().toLowerCase() === String(row.department || '').trim().toLowerCase());
            const project = Store.data.projects.find((p: any) => String(p.name || '').trim().toLowerCase() === String(row.project || '').trim().toLowerCase());
            const account = Store.data.accounts.find((a: any) => String(a.name || '').trim().toLowerCase() === String(row.paid_from || '').trim().toLowerCase());
            const entryRecord: any = {
              id: `other_${row.id}`, type: 'outflow', date: row.payment_date,
              categoryId: category?.id || '', departmentId: department?.id || '', partyKind: party?.kind || 'other', partyId: party?.id || '', projectId: project?.id || '',
              description: row.description || '', refNo: row.reference_no || '', taxable: Number(row.amount_before_gst) || 0,
              gstType: row.gst_type || 'none', gstRate: Number(row.gst_rate) || 0, gstAmount: Number(row.gst_amount) || 0,
              itc: row.input_gst_claimable !== false, tdsRate: 0, tdsAmount: Number(row.tds_amount) || 0, amount: Number(row.net_cash_paid) || 0,
              paymentMode: row.payment_mode || '', accountId: account?.id || '', txnRef: row.utr_cheque_ref || '', notes: row.notes || '',
              attachments: formAttachmentsFromValue(row.attachment_url, 'other_expense', `expense_attachment_${row.id}`),
              supabase_other_expense_id: row.id, deleted: false, createdAt: row.created_at || new Date().toISOString(), updatedAt: row.updated_at || row.created_at || new Date().toISOString()
            };
            const existingIdx = Store.data.entries.findIndex((e: any) => e.supabase_other_expense_id === row.id || (e.type === 'outflow' && e.categoryId === entryRecord.categoryId && e.date === entryRecord.date && e.refNo === entryRecord.refNo && !e.supabase_tax_statutory_id));
            if (existingIdx >= 0) Store.data.entries[existingIdx] = { ...Store.data.entries[existingIdx], ...entryRecord, id: Store.data.entries[existingIdx].id };
            else Store.data.entries.unshift(entryRecord);
          }
        }
        if (typeof (window as any).__supabaseLoadClientPaymentEntries === 'function') {
          const rows = await (window as any).__supabaseLoadClientPaymentEntries();
          const ids = new Set((rows || []).map((row: any) => String(row.id)));
          Store.data.entries = Store.data.entries.filter((e: any) => !e.supabase_client_payment_id || ids.has(String(e.supabase_client_payment_id)));
          for (const row of rows || []) {
            const client = Store.data.parties.find((p: any) => String(p.name || '').trim().toLowerCase() === String(row.client_name || '').trim().toLowerCase());
            const category = Store.data.categories.find((c: any) => String(c.name || '').trim().toLowerCase() === String(row.category || '').trim().toLowerCase());
            const department = Store.data.departments.find((d: any) => String(d.name || '').trim().toLowerCase() === String(row.department || '').trim().toLowerCase());
            const project = Store.data.projects.find((p: any) => String(p.name || '').trim().toLowerCase() === String(row.project || '').trim().toLowerCase());
            const account = Store.data.accounts.find((a: any) => String(a.name || '').trim().toLowerCase() === String(row.received_into || '').trim().toLowerCase());
            const entryRecord: any = {
              id: `client_${row.id}`, type: 'inflow', date: row.payment_date,
              categoryId: category?.id || '', departmentId: department?.id || '', partyKind: 'client', partyId: client?.id || '', projectId: project?.id || '',
              description: row.description || '', refNo: '', taxable: Number(row.amount_before_gst) || 0,
              gstType: row.gst_type || 'none', gstRate: Number(row.gst_rate) || 0, gstAmount: Number(row.gst_amount) || 0, itc: false,
              tdsRate: Number(row.tds_rate) || 0, tdsAmount: Number(row.tds_amount) || 0, amount: Number(row.net_cash_received) || 0,
              paymentMode: row.payment_mode || '', accountId: account?.id || '', txnRef: row.utr_cheque_ref || '', notes: row.notes || '',
              attachments: formAttachmentsFromValue(row.attachment_url, 'client_payment', `client_attachment_${row.id}`),
              supabase_client_payment_id: row.id, deleted: false, createdAt: row.created_at || new Date().toISOString(), updatedAt: row.updated_at || row.created_at || new Date().toISOString()
            };
            const existingIdx = Store.data.entries.findIndex((e: any) => e.supabase_client_payment_id === row.id || (e.type === 'inflow' && e.partyId === entryRecord.partyId && e.date === entryRecord.date && e.txnRef === entryRecord.txnRef && !e.supabase_other_expense_id));
            if (existingIdx >= 0) Store.data.entries[existingIdx] = { ...Store.data.entries[existingIdx], ...entryRecord, id: Store.data.entries[existingIdx].id };
            else Store.data.entries.unshift(entryRecord);
          }
        }
        if (typeof (window as any).__supabaseLoadOtherIncomeEntries === 'function') {
          const rows = await (window as any).__supabaseLoadOtherIncomeEntries();
          const ids = new Set((rows || []).map((row: any) => String(row.id)));
          Store.data.entries = Store.data.entries.filter((e: any) => !e.supabase_other_income_id || ids.has(String(e.supabase_other_income_id)));
          for (const row of rows || []) {
            const category = Store.data.categories.find((c: any) => String(c.name || '').trim().toLowerCase() === String(row.category || '').trim().toLowerCase());
            const party = Store.data.parties.find((p: any) => String(p.name || '').trim().toLowerCase() === String(row.received_from || '').trim().toLowerCase());
            const department = Store.data.departments.find((d: any) => String(d.name || '').trim().toLowerCase() === String(row.department || '').trim().toLowerCase());
            const project = Store.data.projects.find((p: any) => String(p.name || '').trim().toLowerCase() === String(row.project || '').trim().toLowerCase());
            const account = Store.data.accounts.find((a: any) => String(a.name || '').trim().toLowerCase() === String(row.received_into || '').trim().toLowerCase());
            let gstDetails: any = {};
            try { gstDetails = row.gst_details ? JSON.parse(row.gst_details) : {}; } catch { gstDetails = {}; }
            const attachmentPaths = Array.isArray(row.attachment_paths) ? row.attachment_paths : [];
            const otherIncomeAttachments = formAttachmentsFromValue(attachmentPaths, 'other_income', `other_income_attachment_${row.id}`);
            const entryRecord: any = {
              id: `other_income_${row.id}`, type: 'inflow', date: row.payment_date,
              categoryId: category?.id || '', departmentId: department?.id || '', partyKind: party?.kind || 'other', partyId: party?.id || '', projectId: project?.id || '',
              description: row.description || '', refNo: row.reference_no || '', taxable: Number(row.amount) || 0,
              gstType: gstDetails.type || 'none', gstRate: Number(gstDetails.rate) || 0, gstAmount: Number(gstDetails.amount) || 0, itc: false,
              tdsRate: Number(row.tds_percent) || 0, tdsAmount: Number(row.tds_amount) || 0, amount: Number(row.net_cash_received) || 0,
              paymentMode: row.payment_mode || '', accountId: account?.id || '', txnRef: row.utr_reference || '', notes: row.notes || '',
              attachments: otherIncomeAttachments,
              otherIncomeAttachmentPaths: attachmentPaths, departmentAuto: row.department_auto !== false, financialYear: row.financial_year || '', supabase_other_income_id: row.id,
              deleted: false, createdAt: row.created_at || new Date().toISOString(), updatedAt: row.updated_at || row.created_at || new Date().toISOString()
            };
            const existingIdx = Store.data.entries.findIndex((e: any) => e.supabase_other_income_id === row.id || (e.type === 'inflow' && e.categoryId === entryRecord.categoryId && e.date === entryRecord.date && e.refNo === entryRecord.refNo && !e.supabase_client_payment_id));
            if (existingIdx >= 0) Store.data.entries[existingIdx] = { ...Store.data.entries[existingIdx], ...entryRecord, id: Store.data.entries[existingIdx].id };
            else Store.data.entries.unshift(entryRecord);
          }
        }
        if (typeof (window as any).__supabaseLoadPayVendorEntries === 'function') {
          try {
            const rows = await (window as any).__supabaseLoadPayVendorEntries();
            const normalize = (value: any) => String(value || '').trim().toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ');
            for (const row of rows || []) {
              const vendorName = normalize(row.vendor_name);
              const accountName = normalize(row.paid_from);
              const reference = normalize(row.bill_number || row.utr_cheque_reference);
              const amount = Math.abs(Number(row.amount_paid ?? row.net_cash_paid) || 0);
              const matches = Store.data.entries.filter((entry: any) => {
                if (entry.type !== 'outflow' || String(entry.date || '').slice(0, 10) !== String(row.payment_date || '').slice(0, 10)) return false;
                const entryVendor = normalize(entry.partyName || api.get('parties', entry.partyId)?.name);
                const entryAccount = normalize(entry.accountName || api.get('accounts', entry.accountId)?.name);
                if (entryVendor !== vendorName || (accountName && entryAccount !== accountName)) return false;
                if (reference && normalize(entry.refNo || entry.txnRef) !== reference) return false;
                return Math.abs(Math.abs(Number(entry.amount) || 0) - amount) < 0.01;
              });
              const entry = Store.data.entries.find((candidate: any) => String(candidate.supabase_pay_vendor_id || '') === String(row.id))
                || (matches.length === 1 ? matches[0] : null);
              if (!entry) continue;
              entry.supabase_pay_vendor_id = row.id;
              entry.attachments = formAttachmentsFromValue(
                row.attachments,
                'pay a vendor attachment',
                `vendor_attachment_${row.id}`
              );
            }
          } catch (attachmentLoadError: any) {
            console.warn('Could not load Pay a Vendor attachment metadata:', attachmentLoadError);
            payVendorAttachmentLoadError = attachmentLoadError?.message || 'Could not load Pay a Vendor attachments from Supabase.';
          }
        }
        for (const deletedEntry of deletedEntrySnapshots) {
          const currentEntry = Store.data.entries.find((entry: any) =>
            String(entry.id) === String(deletedEntry.id) ||
            (deletedEntry.supabase_id && String(entry.supabase_id || '') === String(deletedEntry.supabase_id)) ||
            Object.keys(deletedEntry).some(key =>
              key.startsWith('supabase_') &&
              deletedEntry[key] &&
              String(entry[key] || '') === String(deletedEntry[key])
            )
          );
          if (currentEntry) {
            Object.assign(currentEntry, {
              deleted: true,
              deletedBy: deletedEntry.deletedBy,
              deletedAt: deletedEntry.deletedAt
            });
          } else {
            Store.data.entries.push(deletedEntry);
          }
        }
        const cancelledIds = new Set(cancelledTransactions.map((transaction: any) => String(transaction.id)));
        const activeIds = new Set(supabaseTransactions.map((transaction: any) => String(transaction.id)));
        const normalize = (value: any) => String(value || '').trim().toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ');
        Store.data.entries = Store.data.entries.filter((entry: any) => {
          const entryId = String(entry.supabase_id || String(entry.id || '').replace(/^e_/, ''));
          if (cancelledIds.has(entryId) || activeIds.has(entryId)) {
            return cancelledIds.has(entryId) ? Boolean(entry.deleted) : true;
          }
          const entryDate = String(entry.date || '').slice(0, 10);
          const entryType = String(entry.type || '').toLowerCase();
          const entryCategory = normalize(api.get('categories', entry.categoryId)?.name || entry.categoryName || entry.category);
          const entryParty = normalize(entry.partyName || api.get('parties', entry.partyId)?.name);
          const entryAccount = normalize(entry.accountName || api.get('accounts', entry.accountId)?.name);
          const entryProject = api.get('projects', entry.projectId);
          const entryProjectCode = normalize(entry.projectCode || entryProject?.code);
          const entryTaxable = Number(entry.taxable ?? entry.amount);
          return !cancelledTransactions.some((transaction: any) => {
            if (String(transaction.transaction_date || '').slice(0, 10) !== entryDate) return false;
            if (String(transaction.transaction_type || '').toLowerCase() !== entryType) return false;
            if (normalize(transaction.party_name) !== entryParty || !entryParty) return false;
            if (normalize(transaction.account_name) !== entryAccount || !entryAccount) return false;
            if (!Number.isFinite(entryTaxable) || Math.abs(Number(transaction.taxable_amount) - entryTaxable) >= 0.01) return false;
            if (entryCategory && normalize(transaction.category) !== entryCategory) return false;
            if (entryProjectCode && normalize(transaction.project_code) !== entryProjectCode) return false;
            return Boolean(entryCategory || entryProjectCode);
          }) || Boolean(entry.deleted);
        });
        refreshCashflowEntriesFromStore();
        const wasHydratingSupabase = isHydratingSupabase.current;
        isHydratingSupabase.current = true;
        try {
          Store.persist();
        } finally {
          isHydratingSupabase.current = wasHydratingSupabase;
        }
        render({ keepScroll: true });
        void syncCreditedDebitedFromEntries(Store.data?.entries || []);
      }

      setCloudStatus(prev => ({
        ...prev,
        connected: true,
        syncing: false,
        transactionCount: supabaseTransactions.length,
        lastSynced: new Date().toLocaleTimeString(),
        error: payVendorAttachmentLoadError
      }));
    } catch (err: any) {
      console.error('Error syncing Supabase transactions:', err);
      setCloudStatus(prev => ({
        ...prev,
        syncing: false,
        error: err.message || 'Error connecting to fss_table_transactions table'
      }));
    }
  }, []);

  // Hydrate Cashflow Inflow from Supabase (fss_operation_receipts, fss_income, fss_financing, fss_cash_inflow, fss_outflow_oc_people)
  const loadSupabaseCashflowTables = useCallback(async (opts: { skipAutoSeed?: boolean } = { skipAutoSeed: true }) => {
    if (!isSupabaseConfigured) return;
    try {
      setCloudStatus(prev => ({ ...prev, syncing: true, error: null }));
      let cashflowLoadWarning: string | null = null;
      const travelRowsPromise = SupabaseService.loadTravelFromSupabase().catch((err: any) => {
        if (err?.code !== 'PGRST205') throw err;
        cashflowLoadWarning = 'The optional fss_outflow_oc_travel table is missing from Supabase; other cashflow data loaded.';
        console.warn(cashflowLoadWarning);
        return [];
      });
      const currentFy = (typeof S !== 'undefined' && S.fy) ? S.fy : 2026;
      let [result, peopleRows, peopleReport, projectCostRows, capexRows, financingAndOwnerRows, officeFixedRows, officeVariableRows, travelRows, professionalAdminRows, taxStatutoryRows, cashOutflowSummaryRows, cashflowStatementRows, byAccountCreditedDebitedRows] = await Promise.all([
        SupabaseService.loadAllCashflowInflowFromSupabase(),
        SupabaseService.loadPeopleFromSupabase(),
        SupabaseService.loadPeopleReportFromSupabase(),
        SupabaseService.loadProjectCostFromSupabase(),
        SupabaseService.loadCapexFromSupabase(),
        SupabaseService.loadFinancingAndOwnerFromSupabase(),
        SupabaseService.loadOfficeFixedFromSupabase(),
        SupabaseService.loadOfficeVariableFromSupabase(),
        travelRowsPromise,
        SupabaseService.loadProfessionalAdminFromSupabase(),
        SupabaseService.loadTaxStatutoryFromSupabase(),
        SupabaseService.loadCashOutflowSummaryFromSupabase(),
        SupabaseService.loadCashflowStatementFromSupabase(),
        SupabaseService.loadByAccountCreditedDebitedFromSupabase(currentFy)
      ]);

      // If tables are empty in Supabase, auto-seed with computed local UI cashflow
      if (
        !opts.skipAutoSeed &&
        result.operationReceipts.length === 0 &&
        result.income.length === 0 &&
        result.financing.length === 0 &&
        Store.data?.entries
      ) {
        console.log('Cashflow tables empty in Supabase. Auto-syncing initial UI cashflow to Supabase...');
        const computed = computeCashflowInflowRows(Store.data.entries, currentFy);
        if (computed) {
          result = await SupabaseService.syncCashflowInflowToSupabase({
            operationReceipts: computed.operationReceiptsRows,
            income: computed.incomeRows,
            financing: computed.financingRows
          });
        }
      }

      let finalPeopleRows = peopleRows;
      let finalPeopleReport = peopleReport;
      let finalProjectCostRows = projectCostRows;
      let finalCapexRows = capexRows;
      let finalFinancingAndOwnerRows = financingAndOwnerRows;
      let finalOfficeFixedRows = officeFixedRows;
      let finalOfficeVariableRows = officeVariableRows;
      let finalTravelRows = travelRows;
      let finalProfessionalAdminRows = professionalAdminRows;
      let finalTaxStatutoryRows = taxStatutoryRows;
      if (!opts.skipAutoSeed && finalPeopleRows.length === 0 && Store.data?.entries) {
        const computedPeople = computeCashflowPeopleRows(Store.data.entries, currentFy);
        if (computedPeople) {
          const syncRes = await SupabaseService.syncPeopleToSupabase(computedPeople);
          finalPeopleRows = syncRes.people;
          finalPeopleReport = syncRes.peopleReport;
        }
      }
      // Reconcile existing People rows and the People report with the values shown by the UI.
      if (!opts?.skipAutoSeed && Store.data?.entries) {
        const computedPeople = computeCashflowPeopleRows(Store.data.entries, currentFy);
        if (computedPeople) {
          const syncRes = await SupabaseService.syncPeopleToSupabase(computedPeople);
          finalPeopleRows = syncRes.people;
          finalPeopleReport = syncRes.peopleReport;
        }
      }
      // Travel must be reconciled before the other outflow table loaders.
      // Some existing tables have legacy schemas (for example Capex without
      // an id column); an error in those tables must not prevent Travel from
      // matching the current UI in Supabase.
      if (!opts?.skipAutoSeed && Store.data?.entries) {
        const computedTravel = computeCashflowOutflowTravelRows(Store.data.entries, currentFy);
        if (computedTravel) {
          const syncRes = await SupabaseService.syncTravelToSupabase(computedTravel.rows);
          finalTravelRows = syncRes.travel;
        }
      }
      // Professional & Admin must also be reconciled before legacy outflow
      // table loaders, so another table's schema error cannot block it.
      if (!opts?.skipAutoSeed && Store.data?.entries) {
        const computedProfessionalAdmin = computeCashflowOutflowProfessionalAdminRows(Store.data.entries, currentFy);
        if (computedProfessionalAdmin) {
          const syncRes = await SupabaseService.syncProfessionalAdminToSupabase(computedProfessionalAdmin.rows);
          finalProfessionalAdminRows = syncRes.professionalAdmin;
        }
      }
      // Reconcile Tax & Statutory before legacy table loaders so their schema
      // errors cannot prevent this section from syncing on page load.
      if (!opts?.skipAutoSeed && Store.data?.entries) {
        const computedTaxStatutory = computeCashflowOutflowTaxStatutoryRows(Store.data.entries, currentFy);
        if (computedTaxStatutory) {
          const syncRes = await SupabaseService.syncTaxStatutoryToSupabase(computedTaxStatutory.rows);
          finalTaxStatutoryRows = syncRes.taxStatutory;
        }
      }
      // Reconcile Financing & Owner before legacy table loaders. A schema
      // failure in another outflow table must not block this section.
      if (!opts?.skipAutoSeed && Store.data?.entries) {
        const computedFinancingAndOwner = computeCashflowOutflowFinancingAndOwnerRows(Store.data.entries, currentFy);
        if (computedFinancingAndOwner) {
          const syncRes = await SupabaseService.syncFinancingAndOwnerToSupabase(computedFinancingAndOwner.rows);
          finalFinancingAndOwnerRows = syncRes.financingAndOwner;
        }
      }
      const needsProjectCostSeed = !opts?.skipAutoSeed && finalProjectCostRows.length === 0;
      if (needsProjectCostSeed && Store.data?.entries) {
        const computedProjectCost = computeCashflowOutflowProjectCostRows(Store.data.entries, currentFy);
        if (computedProjectCost) {
          const syncRes = await SupabaseService.syncProjectCostToSupabase(computedProjectCost.rows);
          finalProjectCostRows = syncRes.projectCost;
        }
      }
      // Reconcile existing Project Costs rows with the values currently shown by the UI.
      // This also repairs stale Supabase values after the one-time seed already ran.
      if (!opts?.skipAutoSeed && Store.data?.entries) {
        const computedProjectCost = computeCashflowOutflowProjectCostRows(Store.data.entries, currentFy);
        if (computedProjectCost) {
          await SupabaseService.syncProjectCost2ToSupabase(computedProjectCost.rows);
          const syncRes = await SupabaseService.syncProjectCostToSupabase(computedProjectCost.rows);
          finalProjectCostRows = syncRes.projectCost;
        }
      }
      // Reconcile existing Capex rows with the values currently shown by the UI.
      if (!opts?.skipAutoSeed && Store.data?.entries) {
        const computedCapex = computeCashflowOutflowCapexRows(Store.data.entries, currentFy);
        if (computedCapex) {
          await SupabaseService.syncCapex2ToSupabase(computedCapex.rows);
          const syncRes = await SupabaseService.syncCapexToSupabase(computedCapex.rows);
          finalCapexRows = syncRes.capex;
        }
      }
      const allCapexNull = finalCapexRows.length > 0 && finalCapexRows.every((r: any) => ['jan_26','feb_26','mar_26','apr_26','may_26','jun_26','jul_26','aug_26','sep_26','oct_26','nov_26','dec_26'].every((m: string) => r[m] == null));
      if (!opts.skipAutoSeed && (finalCapexRows.length === 0 || allCapexNull) && Store.data?.entries) {
        const computedCapex = computeCashflowOutflowCapexRows(Store.data.entries, currentFy);
        if (computedCapex) {
          const syncRes = await SupabaseService.syncCapexToSupabase(computedCapex.rows);
          finalCapexRows = syncRes.capex;
        }
      }
      const allFinancingOwnerNull = finalFinancingAndOwnerRows.length > 0 && finalFinancingAndOwnerRows.every((r: any) => ['jan_26','feb_26','mar_26','apr_26','may_26','jun_26','jul_26','aug_26','sep_26','oct_26','nov_26','dec_26'].every((m: string) => r[m] == null));
      if (!opts.skipAutoSeed && (finalFinancingAndOwnerRows.length === 0 || allFinancingOwnerNull) && Store.data?.entries) {
        const computedFinancingAndOwner = computeCashflowOutflowFinancingAndOwnerRows(Store.data.entries, currentFy);
        if (computedFinancingAndOwner) {
          const syncRes = await SupabaseService.syncFinancingAndOwnerToSupabase(computedFinancingAndOwner.rows);
          finalFinancingAndOwnerRows = syncRes.financingAndOwner;
        }
      }
      const allOfficeFixedNull = finalOfficeFixedRows.length > 0 && finalOfficeFixedRows.every((r: any) => ['jan26','feb26','mar26','apr26','may26','jun26','july26','aug26','sept26','oct26','nov26','dec26'].every((m: string) => r[m] == null));
      if (!opts.skipAutoSeed && (finalOfficeFixedRows.length === 0 || allOfficeFixedNull) && Store.data?.entries) {
        const computedOfficeFixed = computeCashflowOutflowOfficeFixedRows(Store.data.entries, currentFy);
        if (computedOfficeFixed) {
          const syncRes = await SupabaseService.syncOfficeFixedToSupabase(computedOfficeFixed.rows);
          finalOfficeFixedRows = syncRes.officeFixed;
        }
      }
      const allOfficeVariableNull = finalOfficeVariableRows.length > 0 && finalOfficeVariableRows.every((r: any) => ['jan26','feb26','mar26','apr26','may26','jun26','july26','aug26','sept26','oct26','nov26','dec26'].every((m: string) => r[m] == null));
      if (!opts.skipAutoSeed && (finalOfficeVariableRows.length === 0 || allOfficeVariableNull) && Store.data?.entries) {
        const computedOfficeVariable = computeCashflowOutflowOfficeVariableRows(Store.data.entries, currentFy);
        if (computedOfficeVariable) {
          const syncRes = await SupabaseService.syncOfficeVariableToSupabase(computedOfficeVariable.rows);
          finalOfficeVariableRows = syncRes.officeVariable;
        }
      }
      const allTravelNull = finalTravelRows.length > 0 && finalTravelRows.every((r: any) =>
        ['jan26','feb26','mar26','apr26','may26','jun26','july26','aug26','sept26','oct26','nov26','dec26']
          .every((m: string) => r[m] == null || Number(r[m]) === 0)
      );
      if (!opts?.skipAutoSeed && (finalTravelRows.length === 0 || allTravelNull) && Store.data?.entries) {
        const computedTravel = computeCashflowOutflowTravelRows(Store.data.entries, currentFy);
        if (computedTravel) {
          const syncRes = await SupabaseService.syncTravelToSupabase(computedTravel.rows);
          finalTravelRows = syncRes.travel;
        }
      }
      const travelUiSyncKey = 'fss-travel-ui-values-synced-v3';
      // If the new Travel table is still empty, always seed it from the
      // current UI-computed Travel values, even when an older sync flag exists.
      // This prevents NULL rows in the new table from being treated as already
      // synchronized.
      const travelTableNeedsUiSeed = finalTravelRows.length === 0 || allTravelNull;
      if (!opts?.skipAutoSeed && Store.data?.entries) {
        const computedTravel = computeCashflowOutflowTravelRows(Store.data.entries, currentFy);
        if (computedTravel) {
          const normalize = (value: any) => String(value || '').toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
          const travelMonths = [
            { column: 'apr26', month: '04' },
            { column: 'may26', month: '05' },
            { column: 'jun26', month: '06' },
            { column: 'july26', month: '07' },
            { column: 'aug26', month: '08' },
            { column: 'sept26', month: '09' },
            { column: 'oct26', month: '10' },
            { column: 'nov26', month: '11' },
            { column: 'dec26', month: '12' }
          ];
          // Start from the current UI-calculated rows, not the previously
          // loaded Supabase rows. The latter may contain stale values.
          const travelRowsForUi = computedTravel.rows.map((row: any) => ({ ...row }));
          const entries = Store.data.entries || [];
          const entryMatchesTravelRow = (entry: any, category: string) => {
            const categoryId = String(entry.categoryId || '').toLowerCase();
            const entryCategory = normalize(api.get('categories', entry.categoryId)?.name || entry.category || '');
            const rowCategory = normalize(category);
            return entryCategory === rowCategory ||
              ((rowCategory.includes('travel') || rowCategory.includes('conveyance')) &&
                (categoryId === 'cat_travel' || entryCategory.includes('travel') || entryCategory.includes('conveyance'))) ||
              (rowCategory.includes('reimb') &&
                (categoryId === 'cat_reimb' || entryCategory.includes('reimb')));
          };

          for (const computedRow of computedTravel.rows.filter((row: any) => {
            const name = normalize(row.category);
            return name !== 'travel' && !name.includes('total');
          })) {
            let uiRow = travelRowsForUi.find((row: any) => normalize(row.category) === normalize(computedRow.category));
            if (!uiRow) {
              uiRow = { ...computedRow };
              travelRowsForUi.push(uiRow);
            }
            for (const { column, month } of travelMonths) {
              const yearMonth = `${currentFy}-${month}`;
              const matchingEntries = entries.filter((entry: any) =>
                entry.type === 'outflow' &&
                !entry.deleted &&
                String(entry.date || '').slice(0, 7) === yearMonth &&
                entryMatchesTravelRow(entry, computedRow.category)
              );
              const liveValue = matchingEntries.reduce((sum: number, entry: any) =>
                sum + Number(entry.amount || 0), 0);
              const hasDeletedEntry = entries.some((entry: any) =>
                entry.type !== 'transfer' &&
                entry.deleted &&
                String(entry.date || '').slice(0, 7) === yearMonth &&
                entryMatchesTravelRow(entry, computedRow.category)
              );
              const storedValue = uiRow[column] == null ? null : Number(uiRow[column]) || 0;
              uiRow[column] = hasDeletedEntry && liveValue === 0
                ? 0
                : matchingEntries.length > 0
                  ? liveValue
                  : storedValue;
            }
          }
          const syncRes = await SupabaseService.syncTravelToSupabase(travelRowsForUi);
          finalTravelRows = syncRes.travel;
          localStorage.setItem(travelUiSyncKey, '1');
        }
      }
      const allProfessionalAdminNull = finalProfessionalAdminRows.length > 0 && finalProfessionalAdminRows.every((r: any) => ['jan26','feb26','mar26','apr26','may26','jun26','july26','aug26','sept26','oct26','nov26','dec26'].every((m: string) => r[m] == null));
      const professionalAdminUiSyncKey = 'fss-professional-admin-ui-values-synced-v2';
      const needsProfessionalAdminSeed = !opts?.skipAutoSeed &&
        localStorage.getItem(professionalAdminUiSyncKey) !== '1' &&
        (finalProfessionalAdminRows.length === 0 || allProfessionalAdminNull);
      if (needsProfessionalAdminSeed && Store.data?.entries) {
        const computedProfessionalAdmin = computeCashflowOutflowProfessionalAdminRows(Store.data.entries, currentFy);
        if (computedProfessionalAdmin) {
          const syncRes = await SupabaseService.syncProfessionalAdminToSupabase(computedProfessionalAdmin.rows);
          finalProfessionalAdminRows = syncRes.professionalAdmin;
        }
      }
      if (!opts?.skipAutoSeed && Store.data?.entries) {
        const normalize = (value: any) => String(value || '').toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
        const professionalAdminMonths = [
          { column: 'apr26', month: '04' },
          { column: 'may26', month: '05' },
          { column: 'jun26', month: '06' },
          { column: 'july26', month: '07' },
          { column: 'aug26', month: '08' },
          { column: 'sept26', month: '09' },
          { column: 'oct26', month: '10' },
          { column: 'nov26', month: '11' },
          { column: 'dec26', month: '12' }
        ];
        const professionalAdminRowsForUi = finalProfessionalAdminRows.map((row: any) => ({ ...row }));
        const categoriesById = new Map((Store.data.categories || []).map((category: any) => [category.id, category.name]));
        for (const row of professionalAdminRowsForUi) {
          const rowName = normalize(row.category);
          if (!rowName || rowName.includes('total') || rowName === 'professional & admin') continue;
          const categoryId = rowName.includes('audit') || rowName.includes('accounting')
            ? 'cat_ca'
            : rowName.includes('legal') || rowName.includes('compliance')
              ? 'cat_legal'
              : rowName.includes('bank') || rowName.includes('charge')
                ? 'cat_bank'
                : null;
          for (const { column, month } of professionalAdminMonths) {
            const yearMonth = `${currentFy}-${month}`;
            const matchingEntries = Store.data.entries.filter((entry: any) => {
              if (entry.type !== 'outflow' || entry.deleted || String(entry.date || '').slice(0, 7) !== yearMonth) return false;
              const entryCategory = normalize(categoriesById.get(entry.categoryId) || entry.category || '');
              return (categoryId !== null && entry.categoryId === categoryId) || entryCategory === rowName;
            });
            const liveValue = matchingEntries.reduce((sum: number, entry: any) => sum + Number(entry.amount || 0), 0);
            const hasDeletedEntry = Store.data.entries.some((entry: any) => {
              if (entry.type === 'transfer' || !entry.deleted || String(entry.date || '').slice(0, 7) !== yearMonth) return false;
              const entryCategory = normalize(categoriesById.get(entry.categoryId) || entry.category || '');
              return (categoryId !== null && entry.categoryId === categoryId) || entryCategory === rowName;
            });
            // Preserve an explicit NULL from the UI. Empty UI cells must not
            // be converted to zero and must not retain an older cloud value.
            const storedValue = row[column] == null ? null : Number(row[column]) || 0;
            row[column] = hasDeletedEntry && liveValue === 0
              ? 0
              : matchingEntries.length > 0
                ? liveValue
                : storedValue;
          }
        }
        const syncRes = await SupabaseService.syncProfessionalAdminToSupabase(professionalAdminRowsForUi);
        finalProfessionalAdminRows = syncRes.professionalAdmin;
        localStorage.setItem(professionalAdminUiSyncKey, '1');
      }
      const allTaxStatutoryNull = finalTaxStatutoryRows.length > 0 && finalTaxStatutoryRows.every((r: any) => ['jan_26','feb_26','mar_26','apr_26','may_26','jun_26','jul_26','aug_26','sep_26','oct_26','nov_26','dec_26'].every((m: string) => r[m] == null));
      const needsTaxStatutorySeed = !opts?.skipAutoSeed && (finalTaxStatutoryRows.length === 0 || allTaxStatutoryNull);
      if (needsTaxStatutorySeed && Store.data?.entries) {
        const computedTaxStatutory = computeCashflowOutflowTaxStatutoryRows(Store.data.entries, currentFy);
        if (computedTaxStatutory) {
          const syncRes = await SupabaseService.syncTaxStatutoryToSupabase(computedTaxStatutory.rows);
          finalTaxStatutoryRows = syncRes.taxStatutory;
        }
      }
      // Reconcile existing Tax & Statutory rows with the values currently shown by the UI.
      // This repairs stale Supabase values even when the table was already populated.
      if (!opts?.skipAutoSeed && Store.data?.entries) {
        const computedTaxStatutory = computeCashflowOutflowTaxStatutoryRows(Store.data.entries, currentFy);
        if (computedTaxStatutory) {
          const syncRes = await SupabaseService.syncTaxStatutoryToSupabase(computedTaxStatutory.rows);
          finalTaxStatutoryRows = syncRes.taxStatutory;
        }
      }

      if (Store.data) {
        Store.data.fss_operation_receipts = result.operationReceipts;
        Store.data.fss_income = result.income;
        Store.data.fss_financing = result.financing;
        Store.data.fss_cash_inflow = result.cashInflow;
        Store.data.fss_outflow_oc_people = finalPeopleRows;
        Store.data.fss_outflow_oc_people_report = finalPeopleReport;
        Store.data.fss_outflow_project_cost = finalProjectCostRows;
        Store.data.fss_outflow_capex = finalCapexRows;
        Store.data.fss_outflow_financing_and_owner = finalFinancingAndOwnerRows;
        Store.data.fss_outflow_oc_office_fixed = finalOfficeFixedRows;
        Store.data.fss_outflow_oc_office_variable = finalOfficeVariableRows;
        Store.data.fss_outflow_oc_travel = finalTravelRows;
        Store.data.fss_outflow_oc_professional_admin = finalProfessionalAdminRows;
        Store.data.fss_outflow_tax_statutory = finalTaxStatutoryRows;
        Store.data.fss_cash_outflow = cashOutflowSummaryRows;
        Store.data.fss_cash_flow_statement = cashflowStatementRows;
        // Use By Account – Credited & Debited loaded directly from Supabase
        Store.data.fss_by_account_credited_debited = byAccountCreditedDebitedRows;

        // Auto-heal if Supabase ever differs from UI (e.g. outdated fy_to_date, share, or jan_26 > 0)
        const computed = Store.data?.entries
          ? computeCashflowInflowRows(Store.data.entries, currentFy)
          : null;

        const hasDiscrepancy = computed && (
          (result.operationReceipts || []).some((r: any) => {
            const compRow = (computed.operationReceiptsRows as any[])?.find((c: any) => c.id === r.id);
            return compRow && (
              Number(r.fy_to_date) !== Number(compRow.fy_to_date) ||
              Math.abs(Number(r.share) - Number(compRow.share)) > 0.05 ||
              Number(r.jan_26) > 0 ||
              Number(r.oct_26) !== Number(compRow.oct_26)
            );
          }) ||
          (result.income || []).some((r: any) => {
            const compRow = (computed.incomeRows as any[])?.find((c: any) => c.id === r.id);
            return compRow && (
              Number(r.fy_to_date) !== Number(compRow.fy_to_date) ||
              Math.abs(Number(r.share) - Number(compRow.share)) > 0.05 ||
              Number(r.oct_26) !== Number(compRow.oct_26)
            );
          }) ||
          (result.financing || []).some((r: any) => {
            const compRow = (computed.financingRows as any[])?.find((c: any) => c.id === r.id);
            return compRow && (
              Number(r.fy_to_date) !== Number(compRow.fy_to_date) ||
              Math.abs(Number(r.share) - Number(compRow.share)) > 0.05 ||
              Number(r.jan_26) > 0 ||
              Number(r.oct_26) !== Number(compRow.oct_26)
            );
          })
        );

        if (!opts.skipAutoSeed && hasDiscrepancy && computed) {
          result = await SupabaseService.syncCashflowInflowToSupabase({
            operationReceipts: computed.operationReceiptsRows,
            income: computed.incomeRows,
            financing: computed.financingRows
          });
          Store.data.fss_operation_receipts = result.operationReceipts;
          Store.data.fss_income = result.income;
          Store.data.fss_financing = result.financing;
          Store.data.fss_cash_inflow = result.cashInflow;
        }

        const peopleMonthCols = [
          'jan_26', 'feb_26', 'mar_26', 'apr_26', 'may_26', 'jun_26',
          'jul_26', 'aug_26', 'sep_26', 'oct_26', 'nov_26', 'dec_26'
        ];
        const normalizePeopleCategory = (value: any) => String(value || '').trim().toLowerCase();
        const peopleReportMismatch = (finalPeopleRows || []).some((peopleRow: any) => {
          const reportRow = (finalPeopleReport || []).find((row: any) =>
            normalizePeopleCategory(row.category) === normalizePeopleCategory(peopleRow.category)
          );
          return !reportRow || peopleMonthCols.some(month => (
            Math.round(Number(reportRow[month] ?? 0) * 100) !== Math.round(Number(peopleRow[month] ?? 0) * 100)
          ));
        });
        if (peopleReportMismatch) {
          throw new Error('The People report view does not match the People table for one or more months.');
        }

        render({ keepScroll: true });
        void syncCreditedDebitedFromEntries(Store.data?.entries || []);
      }

      setCloudStatus(prev => ({
        ...prev,
        connected: true,
        syncing: false,
        operationReceiptCount: result.operationReceipts.length,
        incomeCount: result.income.length,
        financingCount: result.financing.length,
        cashInflowCount: result.cashInflow.length,
        peopleCount: finalPeopleRows.length,
        projectCostCount: finalProjectCostRows.length,
        capexCount: finalCapexRows.length,
        lastSynced: new Date().toLocaleTimeString(),
        error: cashflowLoadWarning
      }));
      return result;
    } catch (err: any) {
      console.error('Error syncing Supabase cashflow tables:', err);
      setCloudStatus(prev => ({
        ...prev,
        syncing: false,
        error: err.message || 'Error connecting to cashflow tables in Supabase'
      }));
    }
  }, [syncCashOutflowSummary]);

  // Refresh all entities from Supabase
  const refreshAllFromSupabase = useCallback(async () => {
    const wasHydratingSupabase = isHydratingSupabase.current;
    isHydratingSupabase.current = true;
    try {
      await Promise.all([
        loadSupabaseClients(),
        loadSupabaseDepartments()
      ]);
      await Promise.all([
        loadSupabaseVendors(),
        loadSupabaseEmployees(),
        loadSupabaseOtherParties(),
        loadSupabaseProjects(),
        loadSupabaseBankAccounts(),
        loadSupabaseCategories(),
        loadSupabaseOrders(),
        loadSupabaseTransactions()
      ]);
      await loadSupabaseCashflowTables();
    } finally {
      isHydratingSupabase.current = wasHydratingSupabase;
    }
  }, [loadSupabaseClients, loadSupabaseVendors, loadSupabaseEmployees, loadSupabaseOtherParties, loadSupabaseProjects, loadSupabaseDepartments, loadSupabaseBankAccounts, loadSupabaseCategories, loadSupabaseOrders, loadSupabaseTransactions, loadSupabaseCashflowTables, syncCashOutflowSummary]);

  // Initialize Core Application and Supabase
  useEffect(() => {
    let mounted = true;
    let cashflowDebounceTimer: any = null;
    let auditRealtimeChannel: any = null;
    (window as any).__reportAccountSummarySyncError = (error: any) => {
      if (!mounted) return;
      setCloudStatus(prev => ({
        ...prev,
        error: error?.message || String(error) || 'Account totals could not be synchronized.'
      }));
    };
    // Set when a Supabase-backed Cashflow write (e.g. Project Costs cell update) has just been applied,
    // so the auto re-sync from local entries does not overwrite the freshly saved Supabase value.
    let cashflowSyncSuppress = false;

    const init = async () => {
      // 1. Boot original application engine
      try {
        await boot();
        (window as any).Store = Store;
        (window as any).api = api;
        render({ keepScroll: true });
      } catch (err) {
        console.error('Error during boot:', err);
        setCloudStatus(prev => ({
          ...prev,
          connected: false,
          syncing: false,
          error: err instanceof Error ? err.message : String(err)
        }));
        return;
      }

      (window as any).__writeSupabaseAuditLog = async (event: any) => {
        const identity = await SupabaseService.getAuditIdentity();
        const row = await SupabaseService.insertAuditLog({
          ...identity,
          action: String(event.action),
          record_type: String(event.entity),
          record_id: String(event.entityId || ''),
          summary: String(event.summary || ''),
          changes: event.changes || {},
          created_at: String(event.ts || new Date().toISOString())
        });
        if (Store.data) {
          Store.data.audit = [row, ...(Store.data.audit || []).filter((item: any) => item.id !== row.id)]
            .sort((a: any, b: any) => String(b.ts || '').localeCompare(String(a.ts || '')));
          render({ keepScroll: true });
        }
        return row;
      };
      const refreshSupabaseAuditLogs = async () => {
        try {
          const auditRows = await SupabaseService.loadAuditLogs();
          if (Store.data) {
            Store.data.audit = auditRows;
            Store.data.auditLoadError = '';
            Store.persist();
            render({ keepScroll: true });
          }
          return auditRows;
        } catch (error) {
          console.error('Could not refresh Supabase audit logs:', error);
          if (Store.data) {
            Store.data.auditLoadError = error instanceof Error ? error.message : String(error);
            render({ keepScroll: true });
          }
          setCloudStatus(prev => ({
            ...prev,
            error: error instanceof Error ? error.message : String(error)
          }));
          return null;
        }
      };
      (window as any).__refreshSupabaseAuditLogs = refreshSupabaseAuditLogs;
      (window as any).__supabaseDeleteAuditLog = async (id: string) => {
        await SupabaseService.deleteAuditLog(id);
        if (Store.data) {
          Store.data.audit = (Store.data.audit || []).filter((item: any) => String(item.id) !== String(id));
          render({ keepScroll: true });
        }
      };

      // 2. Register global Supabase client saver for the core UI form
      (window as any).__supabaseSaveClient = async (companyData: any, peopleArray: any[], taxData: any) => {
        if (!isSupabaseConfigured) {
          console.warn('Supabase is not configured yet in .env; saving in local offline mode.');
          return null;
        }
        const res = await SupabaseService.saveClient(companyData, peopleArray, taxData);
        if (res?.client) {
          setCloudStatus(prev => ({
            ...prev,
            clientCount: (prev.clientCount || 0) + 1,
            lastSynced: new Date().toLocaleTimeString()
          }));
        }
        return res;
      };

      (window as any).__supabaseDeleteClient = async (clientId: string) => {
        if (!isSupabaseConfigured) return false;
        const ok = await SupabaseService.deleteClient(clientId);
        if (ok) {
          setCloudStatus(prev => ({
            ...prev,
            clientCount: Math.max(0, (prev.clientCount || 1) - 1),
            lastSynced: new Date().toLocaleTimeString()
          }));
        }
        return ok;
      };

      // 3. Register global Supabase vendor saver for the core UI form
      (window as any).__supabaseSaveVendor = async (vendorData: any, peopleArray: any[], taxBankData: any) => {
        if (!isSupabaseConfigured) {
          console.warn('Supabase is not configured yet in .env; saving in local offline mode.');
          return null;
        }
        const res = await SupabaseService.saveVendor(vendorData, peopleArray, taxBankData);
        if (res?.vendor) {
          setCloudStatus(prev => ({
            ...prev,
            vendorCount: (prev.vendorCount || 0) + 1,
            lastSynced: new Date().toLocaleTimeString()
          }));
        }
        return res;
      };

      (window as any).__supabaseSavePayVendorEntry = async (entry: any, rowId?: string, idempotencyKey?: string) => {
        if (!isSupabaseConfigured) throw new Error('Supabase is not configured; vendor payment was not saved to the cloud.');
        const row = await SupabaseService.savePayVendorEntry(entry, rowId, idempotencyKey);
        if (row?.id && Store.data?.supabaseTransactionIds) {
          Store.data.supabaseTransactionIds = Array.from(new Set([...Store.data.supabaseTransactionIds, String(row.id)]));
        }
        refreshCashflowEntriesFromStore();
        void syncCreditedDebitedFromEntries(Store.data?.entries || []);
        setCloudStatus(prev => ({
          ...prev,
          transactionCount: (prev.transactionCount || 0) + (rowId ? 0 : 1),
          lastSynced: new Date().toLocaleTimeString(),
          error: null
        }));
        await refreshSupabaseAuditLogs();
        return row;
      };
      (window as any).__fssQueryTransactions = (filters: any) => SupabaseService.queryFssTransactions(filters);
      (window as any).__fssDeleteTransaction = async (id: string) => {
        await SupabaseService.deleteFssTransaction(id);
        (window as any).__excludeLedgerTransactionFromSummary?.(id);
        if (Store.data?.entries) {
          Store.data.entries = Store.data.entries.filter((e: any) =>
            String(e.supabase_id || '') !== String(id) && String(e.id || '') !== String(id)
          );
          Store.persist();
        }
        await syncCreditedDebitedFromEntries(Store.data?.entries || []);
        await refreshSupabaseAuditLogs();
        render({ keepScroll: true });
      };
      (window as any).__fssOpenTransactionModal = (transaction: any | null) => {
        setFssTransactionToEdit(transaction);
        setIsFssTransactionModalOpen(true);
      };
      (window as any).__computeByAccountCreditedDebitedRows = computeByAccountCreditedDebitedRows;

      const syncUiTransactionsToSupabase = async (opts?: { force?: boolean }) => {
        if (!isSupabaseConfigured) {
          (window as any).IuovaCore?.toast?.('Supabase is not configured', 'bad');
          return { success: false, total: 0, inserted: 0 };
        }
        const entries = Store.data?.entries || [];
        const valid = entries.filter((e: any) => e.date && !e.deleted && e.type !== 'transfer');
        (window as any).IuovaCore?.toast?.(`Storing ${valid.length} transactions into Supabase fss_transactions...`);

        const res = await SupabaseService.syncUiTransactionsToFssTransactions(entries, {
          force: opts?.force ?? true,
          onProgress: (msg) => {
            console.log(msg);
          }
        });

        if (res.success) {
          (window as any).IuovaCore?.toast?.(`✓ Successfully stored ${res.inserted || valid.length} transactions in Supabase table fss_transactions!`, 'good');
          setCloudStatus(prev => ({
            ...prev,
            connected: true,
            transactionCount: Math.max(prev.transactionCount || 0, res.inserted || valid.length),
            lastSynced: new Date().toLocaleTimeString()
          }));
        } else {
          (window as any).IuovaCore?.toast?.(`Failed to store transactions: ${res.error || 'Unknown error'}`, 'bad');
        }
        return res;
      };
      (window as any).syncUiTransactionsToSupabase = syncUiTransactionsToSupabase;
      (window as any).__syncUiTransactionsToSupabase = syncUiTransactionsToSupabase;
      if (S.page === 'ledger') {
        void (window as any).IuovaCore?.refreshLedgerFromSupabase?.();
      }
      (window as any).__supabaseLoadPayVendorEntries = (id?: string) => SupabaseService.loadPayVendorEntries(id);
      (window as any).__supabaseUpdatePayVendorEntry = (id: string, entry: any) => SupabaseService.updatePayVendorEntry(id, entry);
      (window as any).__supabaseDeletePayVendorEntry = (id: string) => SupabaseService.deletePayVendorEntry(id);
      (window as any).__supabaseUploadPayVendorAttachments = (files: File[]) => SupabaseService.uploadPayVendorAttachments(files);
      (window as any).__supabaseDeletePayVendorAttachments = (paths: string[]) => SupabaseService.deletePayVendorAttachments(paths);
      (window as any).__supabaseUploadFormAttachments = (bucket: any, files: File[]) => SupabaseService.uploadFormAttachments(bucket, files);
      (window as any).__supabaseDeleteFormAttachments = (bucket: any, paths: string[]) => SupabaseService.deleteFormAttachments(bucket, paths);

      (window as any).__supabaseSavePayEmployeeEntry = async (entry: any, rowId?: string) => {
        if (!isSupabaseConfigured) throw new Error('Supabase is not configured; employee payment was not saved to the cloud.');
        const row = await SupabaseService.savePayEmployeeEntry(entry, rowId);
        if (row?.id && Store.data?.supabaseTransactionIds) {
          Store.data.supabaseTransactionIds = Array.from(new Set([...Store.data.supabaseTransactionIds, String(row.id)]));
        }
        refreshCashflowEntriesFromStore();
        void syncCreditedDebitedFromEntries(Store.data?.entries || []);
        setCloudStatus(prev => ({
          ...prev,
          transactionCount: (prev.transactionCount || 0) + (rowId ? 0 : 1),
          lastSynced: new Date().toLocaleTimeString(),
          error: null
        }));
        return row;
      };
      (window as any).__supabaseLoadPayEmployeeEntries = () => SupabaseService.loadPayEmployeeEntries();
      (window as any).__supabaseSaveTaxStatutoryEntry = async (entry: any, rowId?: string) => {
        if (!isSupabaseConfigured) throw new Error('Supabase is not configured; tax payment was not saved to the cloud.');
        const row = await SupabaseService.saveTaxStatutoryEntry(entry, rowId);
        if (row?.id && Store.data?.supabaseTransactionIds) {
          Store.data.supabaseTransactionIds = Array.from(new Set([...Store.data.supabaseTransactionIds, String(row.id)]));
        }
        refreshCashflowEntriesFromStore();
        void syncCreditedDebitedFromEntries(Store.data?.entries || []);
        setCloudStatus(prev => ({
          ...prev,
          transactionCount: (prev.transactionCount || 0) + (rowId ? 0 : 1),
          lastSynced: new Date().toLocaleTimeString(),
          error: null
        }));
        return row;
      };
      (window as any).__supabaseLoadTaxStatutoryEntries = () => SupabaseService.loadTaxStatutoryEntries();
      (window as any).__supabaseDeleteTaxStatutoryEntry = (id: string) => SupabaseService.deleteTaxStatutoryEntry(id);
      (window as any).__supabaseSaveOtherExpenseEntry = async (entry: any, rowId?: string) => {
        if (!isSupabaseConfigured) throw new Error('Supabase is not configured; other expense was not saved to the cloud.');
        const row = await SupabaseService.saveOtherExpenseEntry(entry, rowId);
        if (row?.id && Store.data?.supabaseTransactionIds) {
          Store.data.supabaseTransactionIds = Array.from(new Set([...Store.data.supabaseTransactionIds, String(row.id)]));
        }
        refreshCashflowEntriesFromStore();
        void syncCreditedDebitedFromEntries(Store.data?.entries || []);
        setCloudStatus(prev => ({
          ...prev,
          transactionCount: (prev.transactionCount || 0) + (rowId ? 0 : 1),
          lastSynced: new Date().toLocaleTimeString(),
          error: null
        }));
        return row;
      };
      (window as any).__supabaseLoadOtherExpenseEntries = () => SupabaseService.loadOtherExpenseEntries();
      (window as any).__supabaseDeleteOtherExpenseEntry = (id: string) => SupabaseService.deleteOtherExpenseEntry(id);
      (window as any).__supabaseSaveClientPaymentEntry = async (entry: any, rowId?: string) => {
        if (!isSupabaseConfigured) throw new Error('Supabase is not configured; client payment was not saved to the cloud.');
        const row = await SupabaseService.saveClientPaymentEntry(entry, rowId);
        if (row?.id && Store.data?.supabaseTransactionIds) {
          Store.data.supabaseTransactionIds = Array.from(new Set([...Store.data.supabaseTransactionIds, String(row.id)]));
        }
        refreshCashflowEntriesFromStore();
        void syncCreditedDebitedFromEntries(Store.data?.entries || []);
        setCloudStatus(prev => ({
          ...prev,
          transactionCount: (prev.transactionCount || 0) + (rowId ? 0 : 1),
          lastSynced: new Date().toLocaleTimeString(),
          error: null
        }));
        return row;
      };
      (window as any).__supabaseLoadClientPaymentEntries = () => SupabaseService.loadClientPaymentEntries();
      (window as any).__supabaseDeleteClientPaymentEntry = (id: string) => SupabaseService.deleteClientPaymentEntry(id);
      (window as any).__supabaseUploadOtherIncomeAttachments = (files: File[]) => SupabaseService.uploadOtherIncomeAttachments(files);
      (window as any).__supabaseDeleteOtherIncomeAttachments = (paths: string[]) => SupabaseService.deleteOtherIncomeAttachments(paths);
      (window as any).__supabaseSaveOtherIncomeEntry = async (entry: any, rowId?: string) => {
        if (!isSupabaseConfigured) throw new Error('Supabase is not configured; other income was not saved to the cloud.');
        const row = await SupabaseService.saveOtherIncomeEntry(entry, rowId);
        if (row?.id && Store.data?.supabaseTransactionIds) {
          Store.data.supabaseTransactionIds = Array.from(new Set([...Store.data.supabaseTransactionIds, String(row.id)]));
        }
        refreshCashflowEntriesFromStore();
        void syncCreditedDebitedFromEntries(Store.data?.entries || []);
        setCloudStatus(prev => ({
          ...prev,
          transactionCount: (prev.transactionCount || 0) + (rowId ? 0 : 1),
          lastSynced: new Date().toLocaleTimeString(),
          error: null
        }));
        return row;
      };
      (window as any).__supabaseLoadOtherIncomeEntries = () => SupabaseService.loadOtherIncomeEntries();
      (window as any).__supabaseDeleteOtherIncomeEntry = (id: string) => SupabaseService.deleteOtherIncomeEntry(id);

      (window as any).__supabaseDeleteVendor = async (vendorId: string) => {
        if (!isSupabaseConfigured) return false;
        const ok = await SupabaseService.deleteVendor(vendorId);
        if (ok) {
          setCloudStatus(prev => ({
            ...prev,
            vendorCount: Math.max(0, (prev.vendorCount || 1) - 1),
            lastSynced: new Date().toLocaleTimeString()
          }));
        }
        return ok;
      };

      // 4. Register global Supabase employee saver for the core UI form
      (window as any).__supabaseSaveEmployee = async (empData: any) => {
        if (!isSupabaseConfigured) {
          console.warn('Supabase is not configured yet in .env; saving in local offline mode.');
          return null;
        }
        const res = await SupabaseService.saveEmployee(empData);
        if (res) {
          setCloudStatus(prev => ({
            ...prev,
            employeeCount: (prev.employeeCount || 0) + 1,
            lastSynced: new Date().toLocaleTimeString()
          }));
        }
        return res;
      };

      (window as any).__supabaseDeleteEmployee = async (empId: string | number) => {
        if (!isSupabaseConfigured) return false;
        const ok = await SupabaseService.deleteEmployee(empId);
        if (ok) {
          setCloudStatus(prev => ({
            ...prev,
            employeeCount: Math.max(0, (prev.employeeCount || 1) - 1),
            lastSynced: new Date().toLocaleTimeString()
          }));
        }
        return ok;
      };

      // 5. Register global Supabase other party saver for the core UI form
      (window as any).__supabaseSaveOtherParty = async (partyData: any) => {
        if (!isSupabaseConfigured) {
          console.warn('Supabase is not configured yet in .env; saving in local offline mode.');
          return null;
        }
        const res = await SupabaseService.saveOtherParty(partyData);
        if (res) {
          setCloudStatus(prev => ({
            ...prev,
            otherPartyCount: (prev.otherPartyCount || 0) + 1,
            lastSynced: new Date().toLocaleTimeString()
          }));
        }
        return res;
      };

      (window as any).__supabaseDeleteOtherParty = async (partyId: string | number) => {
        if (!isSupabaseConfigured) return false;
        const ok = await SupabaseService.deleteOtherParty(partyId);
        if (ok) {
          setCloudStatus(prev => ({
            ...prev,
            otherPartyCount: Math.max(0, (prev.otherPartyCount || 1) - 1),
            lastSynced: new Date().toLocaleTimeString()
          }));
        }
        return ok;
      };

      // 6. Register global Supabase project saver for the core UI form
      (window as any).__supabaseSaveProject = async (projectData: any) => {
        if (!isSupabaseConfigured) {
          console.warn('Supabase is not configured yet in .env; saving in local offline mode.');
          return null;
        }
        const res = await SupabaseService.saveProject(projectData, Store.data?.parties || []);
        if (res) {
          setCloudStatus(prev => ({
            ...prev,
            projectCount: (prev.projectCount || 0) + 1,
            lastSynced: new Date().toLocaleTimeString()
          }));
        }
        return res;
      };

      (window as any).__supabaseDeleteProject = async (projectIdOrCode: string | number) => {
        if (!isSupabaseConfigured) return false;
        const ok = await SupabaseService.deleteProject(projectIdOrCode);
        if (ok) {
          setCloudStatus(prev => ({
            ...prev,
            projectCount: Math.max(0, (prev.projectCount || 1) - 1),
            lastSynced: new Date().toLocaleTimeString()
          }));
        }
        return ok;
      };

      // 7. Register global Supabase department saver for the core UI form
      (window as any).__supabaseSaveDepartment = async (deptData: any) => {
        if (!isSupabaseConfigured) {
          console.warn('Supabase is not configured yet in .env; saving in local offline mode.');
          return null;
        }
        const res = await SupabaseService.saveDepartment(deptData);
        if (res) {
          setCloudStatus(prev => ({
            ...prev,
            departmentCount: (prev.departmentCount || 0) + 1,
            lastSynced: new Date().toLocaleTimeString()
          }));
        }
        return res;
      };

      (window as any).__supabaseDeleteDepartment = async (departmentIdOrName: string | number) => {
        if (!isSupabaseConfigured) return false;
        const ok = await SupabaseService.deleteDepartment(departmentIdOrName);
        if (ok) {
          setCloudStatus(prev => ({
            ...prev,
            departmentCount: Math.max(0, (prev.departmentCount || 1) - 1),
            lastSynced: new Date().toLocaleTimeString()
          }));
        }
        return ok;
      };

      // 8. Register global Supabase bank account saver for the core UI form
      (window as any).__supabaseSaveBankAccount = async (accData: any) => {
        if (!isSupabaseConfigured) {
          console.warn('Supabase is not configured yet in .env; saving in local offline mode.');
          return null;
        }
        const res = await SupabaseService.saveBankAccount(accData);
        if (res) {
          setCloudStatus(prev => ({
            ...prev,
            bankAccountCount: (prev.bankAccountCount || 0) + 1,
            lastSynced: new Date().toLocaleTimeString()
          }));
        }
        return res;
      };

      (window as any).__supabaseDeleteBankAccount = async (accountIdOrName: string | number) => {
        if (!isSupabaseConfigured) return false;
        const ok = await SupabaseService.deleteBankAccount(accountIdOrName);
        if (ok) {
          setCloudStatus(prev => ({
            ...prev,
            bankAccountCount: Math.max(0, (prev.bankAccountCount || 1) - 1),
            lastSynced: new Date().toLocaleTimeString()
          }));
        }
        return ok;
      };

      // 9. Register global Supabase category saver for the core UI form
      (window as any).__supabaseSaveCategory = async (catData: any) => {
        if (!isSupabaseConfigured) {
          console.warn('Supabase is not configured yet in .env; saving in local offline mode.');
          return null;
        }
        const res = await SupabaseService.saveCategory(catData);
        if (res) {
          setCloudStatus(prev => ({
            ...prev,
            categoryCount: (prev.categoryCount || 0) + 1,
            lastSynced: new Date().toLocaleTimeString()
          }));
        }
        return res;
      };

      (window as any).__supabaseDeleteCategory = async (categoryIdOrName: string | number) => {
        if (!isSupabaseConfigured) return false;
        const ok = await SupabaseService.deleteCategory(categoryIdOrName);
        if (ok) {
          setCloudStatus(prev => ({
            ...prev,
            categoryCount: Math.max(0, (prev.categoryCount || 1) - 1),
            lastSynced: new Date().toLocaleTimeString()
          }));
        }
        return ok;
      };

      // 10. Register global Supabase order saver for the core UI form
      (window as any).__supabaseSaveOrder = async (orderData: any) => {
        if (!isSupabaseConfigured) {
          console.warn('Supabase is not configured yet in .env; saving in local offline mode.');
          return null;
        }
        const res = await SupabaseService.saveOrder(
          orderData,
          Store.data?.parties || [],
          Store.data?.projects || [],
          Store.data?.departments || []
        );
        if (res) {
          setCloudStatus(prev => ({
            ...prev,
            orderCount: (prev.orderCount || 0) + 1,
            lastSynced: new Date().toLocaleTimeString()
          }));
        }
        return res;
      };

      (window as any).__supabaseDeleteOrder = async (orderIdOrNo: string | number) => {
        if (!isSupabaseConfigured) return false;
        const ok = await SupabaseService.deleteOrder(orderIdOrNo);
        if (ok) {
          setCloudStatus(prev => ({
            ...prev,
            orderCount: Math.max(0, (prev.orderCount || 1) - 1),
            lastSynced: new Date().toLocaleTimeString()
          }));
        }
        return ok;
      };

      // 11. Register Supabase Cashflow Inflow Sync and Fetch handlers
      let isSyncingCashflow = false;
      let pendingSyncRequested = false;

      const doSyncCashflowInflow = async () => {
        if (!isSupabaseConfigured) return null;
        try {
          const currentFy = (typeof S !== 'undefined' && S.fy) ? S.fy : 2026;
          const entriesList = Store.data?.cashflowEntries || Store.data?.entries || [];
          const officeFixedComputed = computeCashflowOutflowOfficeFixedRows(entriesList, currentFy);
          const officeVariableComputed = computeCashflowOutflowOfficeVariableRows(entriesList, currentFy);
          if (officeFixedComputed && Store.data) {
            Store.data.fss_outflow_oc_office_fixed = officeFixedComputed.rows;
          }
          if (officeVariableComputed && Store.data) {
            Store.data.fss_outflow_oc_office_variable = officeVariableComputed.rows;
          }
          if ((officeFixedComputed || officeVariableComputed) && Store.data) {
            Store.persist();
            if (typeof render === 'function') {
              render({ keepScroll: true });
            }
          }
          const [officeFixedSynced, officeVariableSynced] = await Promise.all([
            officeFixedComputed
              ? SupabaseService.syncOfficeFixedToSupabase(officeFixedComputed.rows)
              : Promise.resolve(null),
            officeVariableComputed
              ? SupabaseService.syncOfficeVariableToSupabase(officeVariableComputed.rows)
              : Promise.resolve(null)
          ]);
          if (officeFixedSynced && Store.data) {
            Store.data.fss_outflow_oc_office_fixed = officeFixedSynced.officeFixed;
          }
          if (officeVariableSynced && Store.data) {
            Store.data.fss_outflow_oc_office_variable = officeVariableSynced.officeVariable;
          }

          const computed = computeCashflowInflowRows(entriesList, currentFy);
          if (!computed) return null;

          const payloads = {
            operationReceipts: computed.operationReceiptsRows,
            income: computed.incomeRows,
            financing: computed.financingRows
          };

          const peoplePayload = computeCashflowPeopleRows(entriesList, currentFy);
          const [synced, peopleSynced] = await Promise.all([
            SupabaseService.syncCashflowInflowToSupabase(payloads),
            SupabaseService.syncPeopleToSupabase(peoplePayload)
          ]);
          // Sync Travel before legacy outflow tables. A schema error in a
          // different section must not prevent Travel from being persisted.
          const travelComputed = computeCashflowOutflowTravelRows(entriesList, currentFy);
          const travelSynced = travelComputed
            ? await SupabaseService.syncTravelToSupabase(travelComputed.rows)
            : null;
          const professionalAdminComputed = computeCashflowOutflowProfessionalAdminRows(entriesList, currentFy);
          const professionalAdminSynced = professionalAdminComputed
            ? await SupabaseService.syncProfessionalAdminToSupabase(professionalAdminComputed.rows)
            : null;
          const taxStatutoryComputed = computeCashflowOutflowTaxStatutoryRows(entriesList, currentFy);
          const taxStatutorySynced = taxStatutoryComputed
            ? await SupabaseService.syncTaxStatutoryToSupabase(taxStatutoryComputed.rows)
            : null;
          const financingAndOwnerComputed = computeCashflowOutflowFinancingAndOwnerRows(entriesList, currentFy);
          const financingAndOwnerSynced = financingAndOwnerComputed
            ? await SupabaseService.syncFinancingAndOwnerToSupabase(financingAndOwnerComputed.rows)
            : null;
          const projectCostComputed = computeCashflowOutflowProjectCostRows(entriesList, currentFy);
          if (projectCostComputed) {
            await SupabaseService.syncProjectCost2ToSupabase(projectCostComputed.rows);
          }
          const projectCostSynced = projectCostComputed
            ? await SupabaseService.syncProjectCostToSupabase(projectCostComputed.rows)
            : null;
          const capexComputed = computeCashflowOutflowCapexRows(entriesList, currentFy);
          if (capexComputed) {
            await SupabaseService.syncCapex2ToSupabase(capexComputed.rows);
          }
          const capexSynced = capexComputed
            ? await SupabaseService.syncCapexToSupabase(capexComputed.rows)
            : null;
          if (Store.data) {
            Store.data.fss_operation_receipts = synced.operationReceipts;
            Store.data.fss_income = synced.income;
            Store.data.fss_financing = synced.financing;
            Store.data.fss_cash_inflow = synced.cashInflow;
            Store.data.fss_outflow_oc_people = peopleSynced.people;
            Store.data.fss_outflow_oc_people_report = peopleSynced.peopleReport;
            if (projectCostSynced) {
              Store.data.fss_outflow_project_cost = projectCostSynced.projectCost;
            }
            if (capexSynced) {
              Store.data.fss_outflow_capex = capexSynced.capex;
            }
            if (financingAndOwnerSynced) {
              Store.data.fss_outflow_financing_and_owner = financingAndOwnerSynced.financingAndOwner;
            }
            if (travelSynced) {
              Store.data.fss_outflow_oc_travel = travelSynced.travel;
            }
            if (professionalAdminSynced) {
              Store.data.fss_outflow_oc_professional_admin = professionalAdminSynced.professionalAdmin;
            }
            if (officeFixedSynced) {
              Store.data.fss_outflow_oc_office_fixed = officeFixedSynced.officeFixed;
            }
            if (officeVariableSynced) {
              Store.data.fss_outflow_oc_office_variable = officeVariableSynced.officeVariable;
            }
            if (taxStatutorySynced) {
              Store.data.fss_outflow_tax_statutory = taxStatutorySynced.taxStatutory;
            }
            try {
              await syncCreditedDebitedFromEntries(entriesList);
            } catch (cdErr) {
              console.warn('By Account Credited & Debited sync failed in doSyncCashflowInflow:', cdErr);
            }
            // Suppress sync loop when updating local store with synced data
            isSyncingCashflow = true;
            try {
              Store.persist();
            } finally {
              isSyncingCashflow = false;
            }
            if (typeof render === 'function') {
              render({ keepScroll: true });
            }
          }
          setCloudStatus(prev => ({
            ...prev,
            operationReceiptCount: synced.operationReceipts.length,
            incomeCount: synced.income.length,
            financingCount: synced.financing.length,
            cashInflowCount: synced.cashInflow.length,
            peopleCount: peopleSynced.people.length,
            projectCostCount: projectCostSynced?.projectCost?.length ?? (Store.data?.fss_outflow_project_cost || []).length,
            lastSynced: new Date().toLocaleTimeString()
          }));
          return synced;
        } catch (err: any) {
          console.error('Error in doSyncCashflowInflow:', err);
          throw err;
        }
      };

      const triggerCashflowSync = async () => {
        if (!isSupabaseConfigured) return;
        if (isSyncingCashflow) {
          pendingSyncRequested = true;
          return;
        }
        try {
          isSyncingCashflow = true;
          pendingSyncRequested = false;
          await doSyncCashflowInflow();
        } catch (e: any) {
          console.warn('Cashflow sync to Supabase failed:', e);
          setCloudStatus(prev => ({
            ...prev,
            syncing: false,
            error: e?.message || 'Cashflow sync to Supabase failed.'
          }));
        } finally {
          try {
            await syncCashOutflowSummary();
          } catch (summaryError: any) {
            console.error('Error syncing cashflow statement summary:', summaryError);
            setCloudStatus(prev => ({
              ...prev,
              syncing: false,
              error: summaryError?.message || 'Cashflow statement summary sync failed.'
            }));
          }
          isSyncingCashflow = false;
          if (pendingSyncRequested) {
            pendingSyncRequested = false;
            setTimeout(() => triggerCashflowSync(), 150);
          }
        }
      };

      (window as any).__supabaseSyncCashflowInflow = triggerCashflowSync;

      (window as any).__onCashflowDataChanged = () => {
        if (!isSupabaseConfigured || isSyncingCashflow || isHydratingSupabase.current) return;
        refreshCashflowEntriesFromStore();
        if (cashflowSyncSuppress) {
          // A Supabase-backed Cashflow write just happened (e.g. Project Costs cell update).
          // Do not trigger the entries-derived re-sync, otherwise it overwrites the saved Supabase value.
          cashflowSyncSuppress = false;
          if (cashflowDebounceTimer) { clearTimeout(cashflowDebounceTimer); cashflowDebounceTimer = null; }
          return;
        }
        if (cashflowDebounceTimer) clearTimeout(cashflowDebounceTimer);
        cashflowDebounceTimer = setTimeout(() => {
          triggerCashflowSync();
        }, 200);
      };

      (window as any).__supabaseSaveAccountTransfer = async (
        entry: any,
        transferId: string | number | null,
        auditAction: string = transferId ? 'update' : 'create',
        auditBefore: any = null
      ) => {
        if (!isSupabaseConfigured) throw new Error('Supabase is not configured; account transfers cannot be saved offline.');
        const row = await SupabaseService.saveAccountTransfer(
          entry,
          transferId,
          Store.data?.accounts || []
        );
        setCloudStatus(prev => ({
          ...prev,
          connected: true,
          transactionCount: (prev.transactionCount || 0) + (transferId ? 0 : 1),
          lastSynced: new Date().toLocaleTimeString(),
          error: null
        }));
        await recordSupabaseAudit(
          auditAction,
          'entries',
          row.id,
          transactionAuditSummary(row),
          auditBefore,
          row
        );
        return row;
      };
      (window as any).__supabaseSetAccountTransferDeleted = async (id: string | number, deleted: boolean) => {
        if (!isSupabaseConfigured) throw new Error('Supabase is not configured.');
        const deletedBy = deleted ? String(Store.data?.settings?.currentUserId || '') || null : null;
        const entry = Store.data?.entries?.find((candidate: any) =>
          String(candidate.supabase_id || candidate.id) === String(id)
        );
        const before = entry ? { ...entry, deleted: !deleted, status: deleted ? 'Active' : 'Cancelled' } : null;
        const result = await SupabaseService.setAccountTransferDeleted(id, deleted, deletedBy);
        if (result) {
          // Keep the local cache in the same state as Supabase immediately.
          // Without this, balance cards could keep counting a deleted transfer
          // until the next full hydration/reload.
          if (entry) {
            entry.deleted = deleted;
            entry.status = deleted ? 'Cancelled' : 'Active';
            entry.deletedAt = deleted ? new Date().toISOString() : null;
            entry.deletedBy = deleted ? deletedBy : null;
            Store.persist();
          }
          if (deleted) {
            (window as any).__excludeLedgerTransactionFromSummary?.(id);
          } else {
            (window as any).__includeLedgerTransactionInSummary?.(id);
          }
          const after = entry ? { ...entry, deleted, status: deleted ? 'Cancelled' : 'Active' } : null;
          await recordSupabaseAudit(
            deleted ? 'delete' : 'restore',
            'entries',
            id,
            transactionAuditSummary(entry || {}),
            before,
            after
          );
          render({ keepScroll: true });
        }
        return result;
      };

      // 12. Register global Supabase transaction saver for the core UI form
      (window as any).__supabaseSaveTransaction = async (
        entryData: any,
        auditAction?: string,
        auditBefore: any = null
      ) => {
        if (!isSupabaseConfigured) {
          console.warn('Supabase is not configured yet in .env; saving in local offline mode.');
          return null;
        }
        let res = null;
        try {
          res = await SupabaseService.saveTransaction(
            entryData,
            Store.data?.parties || [],
            Store.data?.projects || [],
            Store.data?.departments || [],
            Store.data?.categories || [],
            Store.data?.accounts || []
          );
          if (res) {
            const action = auditAction || (entryData.supabase_id || entryData.supabase_fss_transaction_id ? 'update' : 'create');
            await recordSupabaseAudit(
              action,
              'entries',
              res.id,
              transactionAuditSummary(res),
              auditBefore,
              res
            );
            (window as any).__includeLedgerTransactionInSummary?.(res.id || entryData.supabase_id || entryData.id);
            const localEntry = Store.data?.entries?.find((entry: any) => entry.id === entryData.id);
            if (localEntry) {
              localEntry.supabase_id = res.id;
              const ids = new Set((Store.data?.supabaseTransactionIds || []).map((id: any) => String(id)));
              ids.add(String(res.id));
              Store.data.supabaseTransactionIds = [...ids];
              refreshCashflowEntriesFromStore();
            }
            setCloudStatus(prev => ({
              ...prev,
              transactionCount: (prev.transactionCount || 0) + 1,
              lastSynced: new Date().toLocaleTimeString()
            }));
          }
        } catch (e) {
          console.warn('saveTransaction error in fss_table_transactions:', e);
          const message = e instanceof Error ? e.message : 'Unknown Supabase error';
          (window as any).IuovaCore?.toast(`Transaction saved locally, but Supabase sync failed: ${message}`, 'error');
          throw e;
        }

        // The canonical transaction is saved. Derived summaries can sync after
        // the form closes instead of making the user wait for several extra writes.
        void (async () => {
          const currentFy = (typeof S !== 'undefined' && S.fy) ? S.fy : 2026;
          const liveEntries = Store.data?.cashflowEntries || Store.data?.entries || [];
          const [capexComputed, projectCostComputed] = await Promise.all([
            Promise.resolve(computeCashflowOutflowCapexRows(liveEntries, currentFy)),
            Promise.resolve(computeCashflowOutflowProjectCostRows(liveEntries, currentFy))
          ]);
          if (capexComputed) {
            try {
              await SupabaseService.syncCapex2ToSupabase(capexComputed.rows);
              const capexSynced = await SupabaseService.syncCapexToSupabase(capexComputed.rows);
              if (Store.data) {
                Store.data.fss_outflow_capex = capexSynced.capex;
                Store.persist();
              }
            } catch (error) {
              console.warn('Capex sync failed:', error);
            }
          }
          if (projectCostComputed) {
            try {
              await SupabaseService.syncProjectCost2ToSupabase(projectCostComputed.rows);
              const projectCostSynced = await SupabaseService.syncProjectCostToSupabase(projectCostComputed.rows);
              if (Store.data) {
                Store.data.fss_outflow_project_cost = projectCostSynced.projectCost;
                Store.persist();
              }
            } catch (error) {
              console.warn('Project Costs sync failed:', error);
            }
          }
          try {
            await syncCreditedDebitedFromEntries(Store.data?.entries || []);
          } catch (error) {
            console.warn('By Account Credited & Debited sync failed in saveTransaction:', error);
          }
          await triggerCashflowSync();
        })().catch((error: any) => {
          console.warn('Background transaction summary sync failed:', error);
        });

        return res;
      };

      (window as any).__supabaseCancelTransaction = async (idOrSupabaseId: string | number, entry?: any) => {
        if (!isSupabaseConfigured) return false;
        const res = await SupabaseService.cancelTransaction(idOrSupabaseId, entry);
        if (!res) throw new Error('Failed to cancel transaction in Supabase.');
        const before = entry ? { ...entry, deleted: false, status: 'Active' } : null;
        const after = entry ? { ...entry, deleted: true, status: 'Cancelled' } : null;
        await recordSupabaseAudit(
          'delete',
          'entries',
          entry?.supabase_id || idOrSupabaseId,
          transactionAuditSummary(entry || {}),
          before,
          after
        );
        (window as any).__excludeLedgerTransactionFromSummary?.(idOrSupabaseId);
        void syncCreditedDebitedFromEntries(Store.data?.entries || []).catch(error => {
          console.warn('By Account Credited & Debited sync failed after transaction cancellation:', error);
        });
        void triggerCashflowSync().catch(error => {
          console.warn('Cashflow sync failed after transaction cancellation:', error);
        });
        return res;
      };

      (window as any).__supabaseDeleteTransaction = async (
        idOrSupabaseId: string | number,
        entry?: any,
        options: { skipRefresh?: boolean } = {}
      ) => {
        if (!isSupabaseConfigured) return true;
        if (!options.skipRefresh && (entry?.type === 'outflow' || entry?.type === 'inflow') && entry?.date) {
          const categoryName = String(api.get('categories', entry.categoryId)?.name || entry.category || '')
            .toLowerCase().replace(/[â€“â€”]/g, '-').replace(/\s+/g, ' ').trim();
          const month = String(entry.date).slice(0, 7);
          if (categoryName && /^\d{4}-\d{2}$/.test(month)) {
            const keys: string[] = (window as any).__recentlyDeletedCashKeys || [];
            const key = `${categoryName}|${month}`;
            if (!keys.includes(key)) keys.push(key);
            (window as any).__recentlyDeletedCashKeys = keys;
            render({ keepScroll: true });
          }
        }
        // Purging removes the entry from the local list, so no deleted tombstone remains
        // to invalidate the cached People aggregate. Recompute that category/month from
        // the remaining local transactions immediately to avoid showing a stale value.
        if (!options.skipRefresh && entry?.type === 'outflow' && entry?.date && Store.data?.fss_outflow_oc_people) {
          const monthNumber = String(entry.date).slice(5, 7);
          const monthCol = ({
            '01': 'jan_26', '02': 'feb_26', '03': 'mar_26', '04': 'apr_26',
            '05': 'may_26', '06': 'jun_26', '07': 'jul_26', '08': 'aug_26',
            '09': 'sep_26', '10': 'oct_26', '11': 'nov_26', '12': 'dec_26'
          } as Record<string, string>)[monthNumber];
          const entryCategory = String(api.get('categories', entry.categoryId)?.name || entry.category || '').toLowerCase();
          const entryCategoryId = String(entry.categoryId || '').toLowerCase();
          const peopleCategory = entryCategoryId === 'cat_sal' || (entryCategory.includes('salar') && !entryCategory.includes('ceo'))
            ? 'Salaries'
            : entryCategoryId === 'cat_ceo' || entryCategoryId === 'cat_ceofix' || entryCategory.includes('ceo')
              ? 'CEO Fixed Salary'
              : entryCategoryId === 'cat_welfare' || entryCategory.includes('welfare')
                ? 'Staff Welfare'
                : entryCategoryId === 'cat_bonus' || entryCategory.includes('bonus') || entryCategory.includes('incentive')
                  ? 'Bonus & Incentives'
                  : null;
          if (monthCol && peopleCategory) {
            const categoryRow = Store.data.fss_outflow_oc_people.find((row: any) =>
              String(row.category || '').trim().toLowerCase() === peopleCategory.toLowerCase()
            );
            if (categoryRow) {
              const stillActive = (Store.data.entries || []).filter((candidate: any) => {
                if (candidate.deleted || candidate.type !== 'outflow' || String(candidate.date || '').slice(0, 7) !== String(entry.date).slice(0, 7)) return false;
                const candidateCategoryId = String(candidate.categoryId || '').toLowerCase();
                const candidateName = String(api.get('categories', candidate.categoryId)?.name || candidate.category || '').toLowerCase();
                if (peopleCategory === 'Salaries') return candidateCategoryId === 'cat_sal' || (candidateName.includes('salar') && !candidateName.includes('ceo'));
                if (peopleCategory === 'CEO Fixed Salary') return candidateCategoryId === 'cat_ceo' || candidateCategoryId === 'cat_ceofix' || candidateName.includes('ceo');
                if (peopleCategory === 'Staff Welfare') return candidateCategoryId === 'cat_welfare' || candidateName.includes('welfare');
                return candidateCategoryId === 'cat_bonus' || candidateName.includes('bonus') || candidateName.includes('incentive');
              });
              categoryRow[monthCol] = Math.round(stillActive.reduce((sum: number, candidate: any) =>
                sum + Number(candidate.amount != null ? candidate.amount : candidate.taxable || 0), 0) * 100) / 100;
              Store.persist();
              render({ keepScroll: true });
            }
          }
        }
        const ok = await SupabaseService.deleteTransaction(idOrSupabaseId, entry);
        if (!ok) throw new Error('Failed to delete transaction from Supabase.');
        if (ok) {
          await recordSupabaseAudit(
            'purge',
            'entries',
            entry?.supabase_id || idOrSupabaseId,
            `Permanently deleted · ${transactionAuditSummary(entry || {})}`,
            entry,
            null
          );
          (window as any).__excludeLedgerTransactionFromSummary?.(idOrSupabaseId);
          if (!options.skipRefresh) {
            setCloudStatus(prev => ({
              ...prev,
              transactionCount: Math.max(0, (prev.transactionCount || 1) - 1),
              lastSynced: new Date().toLocaleTimeString()
            }));
          }
        }
        if (!options.skipRefresh) {
          await syncCreditedDebitedFromEntries(Store.data?.entries || []);
          try {
            await triggerCashflowSync();
          } catch (e) {
            console.warn('Cashflow sync failed:', e);
          }
        }
        return ok;
      };
      (window as any).__supabaseRefreshAfterTransactionPurge = async () => {
        await syncCreditedDebitedFromEntries(Store.data?.entries || []);
        await triggerCashflowSync();
      };

      (window as any).__supabaseFetchCashflowInflow = async () => {
        return loadSupabaseCashflowTables();
      };

      // Direct cell edit handler for Operating Receipts
      (window as any).__updateOperationReceiptCell = async (idOrName: number | string, monthCol: string, newValue: number | string) => {
        if (!isSupabaseConfigured) return null;
        setCloudStatus(prev => ({ ...prev, syncing: true, error: null }));
        try {
          const res = await SupabaseService.updateOperationReceiptCell(idOrName, monthCol, newValue);
          if (Store.data) {
            Store.data.fss_operation_receipts = res.allRows;
            Store.persist();
          }
          await syncCashOutflowSummary();
          setCloudStatus(prev => ({
            ...prev,
            syncing: false,
            lastSynced: new Date().toLocaleTimeString(),
            error: null
          }));
          render({ keepScroll: true });
          return res;
        } catch (err: any) {
          console.error('Error in __updateOperationReceiptCell:', err);
          setCloudStatus(prev => ({ ...prev, syncing: false, error: err.message }));
          throw err;
        }
      };

      // Add new Operating Receipt entry
      (window as any).__addOperationReceipt = async (receiptName: string, monthlyAmounts: Record<string, number> = {}) => {
        if (!isSupabaseConfigured) return null;
        setCloudStatus(prev => ({ ...prev, syncing: true, error: null }));
        try {
          const res = await SupabaseService.addOperationReceipt(receiptName, monthlyAmounts);
          await loadSupabaseCashflowTables();
          render({ keepScroll: true });
          return res;
        } catch (err: any) {
          console.error('Error in __addOperationReceipt:', err);
          setCloudStatus(prev => ({ ...prev, syncing: false, error: err.message }));
          throw err;
        }
      };

      // Direct cell edit handler for Other Income
      (window as any).__updateIncomeCell = async (idOrName: number | string, monthCol: string, newValue: number | string) => {
        if (!isSupabaseConfigured) return null;
        setCloudStatus(prev => ({ ...prev, syncing: true, error: null }));
        try {
          const res = await SupabaseService.updateIncomeCell(idOrName, monthCol, newValue);
          if (Store.data) {
            Store.data.fss_income = res.allRows;
            Store.persist();
          }
          await syncCashOutflowSummary();
          setCloudStatus(prev => ({
            ...prev,
            syncing: false,
            lastSynced: new Date().toLocaleTimeString(),
            error: null
          }));
          render({ keepScroll: true });
          return res;
        } catch (err: any) {
          console.error('Error in __updateIncomeCell:', err);
          setCloudStatus(prev => ({ ...prev, syncing: false, error: err.message }));
          throw err;
        }
      };

      // Add new Other Income entry
      (window as any).__addIncome = async (incomeName: string, monthlyAmounts: Record<string, number> = {}) => {
        if (!isSupabaseConfigured) return null;
        setCloudStatus(prev => ({ ...prev, syncing: true, error: null }));
        try {
          const res = await SupabaseService.addIncome(incomeName, monthlyAmounts);
          await loadSupabaseCashflowTables();
          render({ keepScroll: true });
          return res;
        } catch (err: any) {
          console.error('Error in __addIncome:', err);
          setCloudStatus(prev => ({ ...prev, syncing: false, error: err.message }));
          throw err;
        }
      };

      // Direct cell edit handler for Financing
      (window as any).__updateFinancingCell = async (idOrName: number | string, monthCol: string, newValue: number | string) => {
        if (!isSupabaseConfigured) return null;
        setCloudStatus(prev => ({ ...prev, syncing: true, error: null }));
        try {
          const res = await SupabaseService.updateFinancingCell(idOrName, monthCol, newValue);
          if (Store.data) {
            Store.data.fss_financing = res.allRows;
            Store.persist();
          }
          await syncCashOutflowSummary();
          setCloudStatus(prev => ({
            ...prev,
            syncing: false,
            lastSynced: new Date().toLocaleTimeString(),
            error: null
          }));
          render({ keepScroll: true });
          return res;
        } catch (err: any) {
          console.error('Error in __updateFinancingCell:', err);
          setCloudStatus(prev => ({ ...prev, syncing: false, error: err.message }));
          throw err;
        }
      };

      // Add new Financing entry
      (window as any).__addFinancing = async (financingName: string, monthlyAmounts: Record<string, number> = {}) => {
        if (!isSupabaseConfigured) return null;
        setCloudStatus(prev => ({ ...prev, syncing: true, error: null }));
        try {
          const res = await SupabaseService.addFinancing(financingName, monthlyAmounts);
          await loadSupabaseCashflowTables();
          render({ keepScroll: true });
          return res;
        } catch (err: any) {
          console.error('Error in __addFinancing:', err);
          setCloudStatus(prev => ({ ...prev, syncing: false, error: err.message }));
          throw err;
        }
      };

      // Direct cell edit handler for People Outflow (fss_outflow_oc_people)
      (window as any).__updatePeopleCell = async (idOrCategory: number | string, monthCol: string, newValue: number | string) => {
        if (!isSupabaseConfigured) return null;
        setCloudStatus(prev => ({ ...prev, syncing: true, error: null }));
        try {
          const res = await SupabaseService.updatePeopleCell(idOrCategory, monthCol, newValue);
          if (Store.data) {
            Store.data.fss_outflow_oc_people = res.allRows;
            Store.data.fss_outflow_oc_people_report = res.reportRows;
            cashflowSyncSuppress = true;
            Store.persist();
          }
          await syncCashOutflowSummary();
          setCloudStatus(prev => ({
            ...prev,
            syncing: false,
            lastSynced: new Date().toLocaleTimeString(),
            error: null
          }));
          render({ keepScroll: true });
          return res;
        } catch (err: any) {
          console.error('Error in __updatePeopleCell:', err);
          setCloudStatus(prev => ({ ...prev, syncing: false, error: err.message }));
          throw err;
        }
      };

      // Add new People entry
      (window as any).__addPeopleExpense = async (categoryName: string, monthlyAmounts: Record<string, number> = {}) => {
        if (!isSupabaseConfigured) return null;
        setCloudStatus(prev => ({ ...prev, syncing: true, error: null }));
        try {
          const res = await SupabaseService.addPeopleExpense(categoryName, monthlyAmounts);
          await loadSupabaseCashflowTables();
          render({ keepScroll: true });
          return res;
        } catch (err: any) {
          console.error('Error in __addPeopleExpense:', err);
          setCloudStatus(prev => ({ ...prev, syncing: false, error: err.message }));
          throw err;
        }
      };

      // Direct cell edit handler for Project Costs Outflow (fss_outflow_project_cost)
      (window as any).__updateProjectCostCell = async (idOrCategory: number | string, monthCol: string, newValue: number | string) => {
        if (!isSupabaseConfigured) return null;
        setCloudStatus(prev => ({ ...prev, syncing: true, error: null }));
        try {
          const res = await SupabaseService.updateProjectCostCell(idOrCategory, monthCol, newValue);
          await SupabaseService.syncProjectCost2ToSupabase(res.allRows);
          if (Store.data) {
            Store.data.fss_outflow_project_cost = res.allRows;
            cashflowSyncSuppress = true;
            Store.persist();
          }
          await syncCashOutflowSummary();
          setCloudStatus(prev => ({
            ...prev,
            syncing: false,
            lastSynced: new Date().toLocaleTimeString(),
            error: null
          }));
          render({ keepScroll: true });
          return res;
        } catch (err: any) {
          console.error('Error in __updateProjectCostCell:', err);
          setCloudStatus(prev => ({ ...prev, syncing: false, error: err.message }));
          throw err;
        }
      };

      // Add new Project Costs entry
      (window as any).__addProjectCostExpense = async (categoryName: string, monthlyAmounts: Record<string, number> = {}) => {
        if (!isSupabaseConfigured) return null;
        setCloudStatus(prev => ({ ...prev, syncing: true, error: null }));
        try {
          const res = await SupabaseService.addProjectCostExpense(categoryName, monthlyAmounts);
          await loadSupabaseCashflowTables();
          render({ keepScroll: true });
          return res;
        } catch (err: any) {
          console.error('Error in __addProjectCostExpense:', err);
          setCloudStatus(prev => ({ ...prev, syncing: false, error: err.message }));
          throw err;
        }
      };

      // Direct cell edit handler for Tax & Statutory Outflow (fss_outflow_tax_statutory)
      (window as any).__updateTaxStatutoryCell = async (idOrCategory: number | string, monthCol: string, newValue: number | string) => {
        if (!isSupabaseConfigured) return null;
        setCloudStatus(prev => ({ ...prev, syncing: true, error: null }));
        try {
          const res = await SupabaseService.updateTaxStatutoryCell(idOrCategory, monthCol, newValue);
          if (Store.data) {
            Store.data.fss_outflow_tax_statutory = res.allRows;
            cashflowSyncSuppress = true;
            Store.persist();
          }
          await syncCashOutflowSummary();
          setCloudStatus(prev => ({
            ...prev,
            syncing: false,
            lastSynced: new Date().toLocaleTimeString(),
            error: null
          }));
          render({ keepScroll: true });
          return res;
        } catch (err: any) {
          console.error('Error in __updateTaxStatutoryCell:', err);
          setCloudStatus(prev => ({ ...prev, syncing: false, error: err.message }));
          throw err;
        }
      };

      // Add new Tax & Statutory entry
      (window as any).__addTaxStatutoryExpense = async (categoryName: string, monthlyAmounts: Record<string, number> = {}) => {
        if (!isSupabaseConfigured) return null;
        setCloudStatus(prev => ({ ...prev, syncing: true, error: null }));
        try {
          const res = await SupabaseService.addTaxStatutoryExpense(categoryName, monthlyAmounts);
          await loadSupabaseCashflowTables({ skipAutoSeed: true });
          render({ keepScroll: true });
          return res;
        } catch (err: any) {
          console.error('Error in __addTaxStatutoryExpense:', err);
          setCloudStatus(prev => ({ ...prev, syncing: false, error: err.message }));
          throw err;
        }
      };

      // Direct cell edit handler for Travel Outflow (fss_outflow_oc_travel)
      (window as any).__updateTravelCell = async (idOrCategory: number | string, monthCol: string, newValue: number | string | null) => {
        if (!isSupabaseConfigured) return null;
        setCloudStatus(prev => ({ ...prev, syncing: true, error: null }));
        try {
          const res = await SupabaseService.updateTravelCell(idOrCategory, monthCol, newValue);
          if (Store.data) {
            Store.data.fss_outflow_oc_travel = res.allRows;
            cashflowSyncSuppress = true;
            Store.persist();
          }
          await syncCashOutflowSummary();
          setCloudStatus(prev => ({
            ...prev,
            syncing: false,
            lastSynced: new Date().toLocaleTimeString(),
            error: null
          }));
          render({ keepScroll: true });
          return res;
        } catch (err: any) {
          console.error('Error in __updateTravelCell:', err);
          setCloudStatus(prev => ({ ...prev, syncing: false, error: err.message }));
          throw err;
        }
      };

      (window as any).__addTravelExpense = async (categoryName: string, monthlyAmounts: Record<string, number> = {}) => {
        if (!isSupabaseConfigured) return null;
        setCloudStatus(prev => ({ ...prev, syncing: true, error: null }));
        try {
          const res = await SupabaseService.addTravelExpense(categoryName, monthlyAmounts);
          await loadSupabaseCashflowTables({ skipAutoSeed: true });
          render({ keepScroll: true });
          return res;
        } catch (err: any) {
          console.error('Error in __addTravelExpense:', err);
          setCloudStatus(prev => ({ ...prev, syncing: false, error: err.message }));
          throw err;
        }
      };

      // Direct cell edit handler for Professional & Admin Outflow (fss_outflow_oc_professional_admin)
      (window as any).__updateProfessionalAdminCell = async (idOrCategory: number | string, monthCol: string, newValue: number | string) => {
        if (!isSupabaseConfigured) return null;
        setCloudStatus(prev => ({ ...prev, syncing: true, error: null }));
        try {
          const res = await SupabaseService.updateProfessionalAdminCell(idOrCategory, monthCol, newValue);
          if (Store.data) {
            Store.data.fss_outflow_oc_professional_admin = res.allRows;
            cashflowSyncSuppress = true;
            Store.persist();
          }
          await syncCashOutflowSummary();
          setCloudStatus(prev => ({
            ...prev,
            syncing: false,
            lastSynced: new Date().toLocaleTimeString(),
            error: null
          }));
          render({ keepScroll: true });
          return res;
        } catch (err: any) {
          console.error('Error in __updateProfessionalAdminCell:', err);
          setCloudStatus(prev => ({ ...prev, syncing: false, error: err.message }));
          throw err;
        }
      };

      (window as any).__addProfessionalAdminExpense = async (categoryName: string, monthlyAmounts: Record<string, number> = {}) => {
        if (!isSupabaseConfigured) return null;
        setCloudStatus(prev => ({ ...prev, syncing: true, error: null }));
        try {
          const res = await SupabaseService.addProfessionalAdminExpense(categoryName, monthlyAmounts);
          await loadSupabaseCashflowTables({ skipAutoSeed: true });
          render({ keepScroll: true });
          return res;
        } catch (err: any) {
          console.error('Error in __addProfessionalAdminExpense:', err);
          setCloudStatus(prev => ({ ...prev, syncing: false, error: err.message }));
          throw err;
        }
      };

      // Direct cell edit handler for Office Fixed Outflow (fss_outflow_oc_office_fixed)
      (window as any).__updateOfficeFixedCell = async (idOrCategory: number | string, monthCol: string, newValue: number | string) => {
        if (!isSupabaseConfigured) return null;
        setCloudStatus(prev => ({ ...prev, syncing: true, error: null }));
        try {
          const res = await SupabaseService.updateOfficeFixedCell(idOrCategory, monthCol, newValue);
          if (Store.data) {
            Store.data.fss_outflow_oc_office_fixed = res.allRows;
            cashflowSyncSuppress = true;
            Store.persist();
          }
          await syncCashOutflowSummary();
          setCloudStatus(prev => ({
            ...prev,
            syncing: false,
            lastSynced: new Date().toLocaleTimeString(),
            error: null
          }));
          render({ keepScroll: true });
          return res;
        } catch (err: any) {
          console.error('Error in __updateOfficeFixedCell:', err);
          setCloudStatus(prev => ({ ...prev, syncing: false, error: err.message }));
          throw err;
        }
      };

      (window as any).__addOfficeFixedExpense = async (categoryName: string, monthlyAmounts: Record<string, number> = {}) => {
        if (!isSupabaseConfigured) return null;
        setCloudStatus(prev => ({ ...prev, syncing: true, error: null }));
        try {
          const res = await SupabaseService.addOfficeFixedExpense(categoryName, monthlyAmounts);
          await loadSupabaseCashflowTables({ skipAutoSeed: true });
          render({ keepScroll: true });
          return res;
        } catch (err: any) {
          console.error('Error in __addOfficeFixedExpense:', err);
          setCloudStatus(prev => ({ ...prev, syncing: false, error: err.message }));
          throw err;
        }
      };

      // Direct cell edit handler for Office Variable Outflow (fss_outflow_oc_office_variable)
      (window as any).__updateOfficeVariableCell = async (idOrCategory: number | string, monthCol: string, newValue: number | string) => {
        if (!isSupabaseConfigured) return null;
        setCloudStatus(prev => ({ ...prev, syncing: true, error: null }));
        try {
          const res = await SupabaseService.updateOfficeVariableCell(idOrCategory, monthCol, newValue);
          if (Store.data) {
            Store.data.fss_outflow_oc_office_variable = res.allRows;
            cashflowSyncSuppress = true;
            Store.persist();
          }
          await syncCashOutflowSummary();
          setCloudStatus(prev => ({
            ...prev,
            syncing: false,
            lastSynced: new Date().toLocaleTimeString(),
            error: null
          }));
          render({ keepScroll: true });
          return res;
        } catch (err: any) {
          console.error('Error in __updateOfficeVariableCell:', err);
          setCloudStatus(prev => ({ ...prev, syncing: false, error: err.message }));
          throw err;
        }
      };

      (window as any).__addOfficeVariableExpense = async (categoryName: string, monthlyAmounts: Record<string, number> = {}) => {
        if (!isSupabaseConfigured) return null;
        setCloudStatus(prev => ({ ...prev, syncing: true, error: null }));
        try {
          const res = await SupabaseService.addOfficeVariableExpense(categoryName, monthlyAmounts);
          await loadSupabaseCashflowTables({ skipAutoSeed: true });
          render({ keepScroll: true });
          return res;
        } catch (err: any) {
          console.error('Error in __addOfficeVariableExpense:', err);
          setCloudStatus(prev => ({ ...prev, syncing: false, error: err.message }));
          throw err;
        }
      };

      // By Account – Credited & Debited handlers
      (window as any).__loadByAccountCreditedDebited = async () => {
        if (!isSupabaseConfigured) return [];
        try {
          const currentFy = (typeof S !== 'undefined' && S.fy) ? S.fy : 2026;
          const rows = await SupabaseService.loadByAccountCreditedDebitedFromSupabase(currentFy);
          if (Store.data) {
            Store.data.fss_by_account_credited_debited = rows;
            Store.persist();
          }
          render({ keepScroll: true });
          return rows;
        } catch (err: any) {
          console.error('Error in __loadByAccountCreditedDebited:', err);
          throw err;
        }
      };

      (window as any).__updateAccountBalanceCell = async (
        accId: string | number,
        accName: string,
        periodKey: string,
        periodCol: string,
        periodIdx: number,
        newValue: number | string | null
      ) => {
        const numVal = (newValue === '' || newValue === null || newValue === undefined || isNaN(Number(newValue))) ? 0 : Number(newValue);
        let acc = (Store.data?.accounts || []).find((a: any) =>
          String(a.id) === String(accId) ||
          String(a.supabase_id || '') === String(accId) ||
          String(a.name || '').trim().toLowerCase() === String(accName || '').trim().toLowerCase()
        );
        if (acc) {
          acc.monthlyBalances = acc.monthlyBalances || {};
          if (periodKey) acc.monthlyBalances[periodKey] = numVal;
          if (periodCol) acc.monthlyBalances[periodCol] = numVal;
          if (periodIdx === 0) {
            acc.openingBalance = numVal;
          }
        }
        if (Store.data) {
          Store.data.account_monthly_balances = Store.data.account_monthly_balances || {};
          const key = String(acc?.id || accId);
          Store.data.account_monthly_balances[key] = Store.data.account_monthly_balances[key] || {};
          if (periodKey) Store.data.account_monthly_balances[key][periodKey] = numVal;
          if (periodCol) Store.data.account_monthly_balances[key][periodCol] = numVal;
          Store.persist();
        }

        if (isSupabaseConfigured && acc && periodIdx === 0) {
          try {
            await SupabaseService.saveBankAccount({
              id: acc.supabase_id || acc.id,
              account_name: acc.name,
              account_type: acc.type,
              account_number_masked: acc.number,
              opening_balance: numVal,
              opening_balance_date: acc.openingBalanceDate || Store.data?.settings?.openingDate || '2025-04-01'
            });
          } catch (sbErr) {
            console.warn('Could not mirror account opening balance to Supabase:', sbErr);
          }
        }

        render({ keepScroll: true });
        return numVal;
      };

      (window as any).__updateByAccountCreditedDebitedCell = async (id: number | string, monthCol: string, newValue: number | string | null) => {
        if (!isSupabaseConfigured) return null;
        setCloudStatus(prev => ({ ...prev, syncing: true, error: null }));
        try {
          const numVal = (newValue === '' || newValue === null || newValue === undefined || isNaN(Number(newValue))) ? null : Number(newValue);
          const currentFy = (typeof S !== 'undefined' && S.fy) ? S.fy : 2026;
          const allRows = await SupabaseService.updateByAccountCreditedDebitedCell(id, monthCol, numVal, currentFy);
          if (Store.data) {
            Store.data.fss_by_account_credited_debited = allRows;
            Store.persist();
          }
          setCloudStatus(prev => ({
            ...prev,
            syncing: false,
            lastSynced: new Date().toLocaleTimeString(),
            error: null
          }));
          render({ keepScroll: true });
          return allRows;
        } catch (err: any) {
          console.error('Error in __updateByAccountCreditedDebitedCell:', err);
          setCloudStatus(prev => ({ ...prev, syncing: false, error: err.message }));
          throw err;
        }
      };

      (window as any).__insertByAccountCreditedDebited = async (accountName: string) => {
        if (!isSupabaseConfigured) return null;
        setCloudStatus(prev => ({ ...prev, syncing: true, error: null }));
        try {
          const currentFy = (typeof S !== 'undefined' && S.fy) ? S.fy : 2026;
          const allRows = await SupabaseService.insertByAccountCreditedDebited(accountName, currentFy);
          if (Store.data) {
            Store.data.fss_by_account_credited_debited = allRows;
            Store.persist();
          }
          setCloudStatus(prev => ({
            ...prev,
            syncing: false,
            lastSynced: new Date().toLocaleTimeString(),
            error: null
          }));
          render({ keepScroll: true });
          return allRows;
        } catch (err: any) {
          console.error('Error in __insertByAccountCreditedDebited:', err);
          setCloudStatus(prev => ({ ...prev, syncing: false, error: err.message }));
          throw err;
        }
      };

      (window as any).__deleteByAccountCreditedDebited = async (accountName: string) => {
        if (!isSupabaseConfigured) return null;
        setCloudStatus(prev => ({ ...prev, syncing: true, error: null }));
        try {
          const currentFy = (typeof S !== 'undefined' && S.fy) ? S.fy : 2026;
          const allRows = await SupabaseService.deleteByAccountCreditedDebited(accountName, currentFy);
          if (Store.data) {
            Store.data.fss_by_account_credited_debited = allRows;
            Store.persist();
          }
          setCloudStatus(prev => ({
            ...prev,
            syncing: false,
            lastSynced: new Date().toLocaleTimeString(),
            error: null
          }));
          render({ keepScroll: true });
          return allRows;
        } catch (err: any) {
          console.error('Error in __deleteByAccountCreditedDebited:', err);
          setCloudStatus(prev => ({ ...prev, syncing: false, error: err.message }));
          throw err;
        }
      };

      (window as any).__syncByAccountCreditedDebited = async () => {
        if (!isSupabaseConfigured) return null;
        try {
          await syncCreditedDebitedFromEntries(Store.data?.entries || []);
          const rows = Store.data?.fss_by_account_credited_debited || [];
          render({ keepScroll: true });
          return rows;
        } catch (err: any) {
          console.warn('Error in __syncByAccountCreditedDebited:', err);
          setCloudStatus(prev => ({ ...prev, error: err?.message || 'Account totals could not be synchronized.' }));
        }
        return null;
      };

      (window as any).__syncByAccountTransfer = async (rows: any[]) => {
        if (!isSupabaseConfigured) return rows || [];
        const syncKey = JSON.stringify(rows || []);
        if (syncKey === byAccountTransferSyncKey) return rows || [];
        byAccountTransferSyncKey = syncKey;
        try {
          return await SupabaseService.syncByAccountTransferToSupabase(rows || []);
        } catch (err: any) {
          byAccountTransferSyncKey = '';
          console.error('Error in __syncByAccountTransfer:', err);
          setCloudStatus(prev => ({ ...prev, error: err?.message || 'By account balances could not be synchronized.' }));
          return null;
        }
      };

      // Delete handlers for Cash Outflow (fss_outflow_*) tables
      const registerOutflowDelete = (globalName: string, serviceMethod: string, opts?: { skipAutoSeed?: boolean; markProfessionalAdminConfigured?: boolean }) => {
        (window as any)[globalName] = async (idOrKey: any, monthCol?: string) => {
          if (!isSupabaseConfigured) return false;
          setCloudStatus(prev => ({ ...prev, syncing: true, error: null }));
          try {
            const ok = await (SupabaseService as any)[serviceMethod](idOrKey, monthCol);
            if (!ok) throw new Error(`Failed to delete record from Supabase.`);
            if (serviceMethod === 'deleteCapex' || serviceMethod === 'deleteCapexExpense' || serviceMethod === 'deleteCapexFromSupabase' || serviceMethod === 'deleteCapexRow') {
              await SupabaseService.deleteCapex2(idOrKey);
            }
            if (serviceMethod === 'deleteProjectCost' || serviceMethod === 'deleteProjectCostExpense' || serviceMethod === 'deleteProjectCostFromSupabase' || serviceMethod === 'deleteProjectCostRow') {
              const siblingDeleted = await SupabaseService.deleteProjectCost2(idOrKey, monthCol);
              if (!siblingDeleted) throw new Error('Failed to update/delete record in fss_outflow_project_cost_2.');
            }
            if (opts?.markProfessionalAdminConfigured) {
              localStorage.setItem('fss-professional-admin-ui-values-synced-v2', '1');
            }
            await loadSupabaseCashflowTables(opts);
            setCloudStatus(prev => ({ ...prev, syncing: false, lastSynced: new Date().toLocaleTimeString(), error: null }));
            render({ keepScroll: true });
            return true;
          } catch (err: any) {
            console.error(`Error in ${globalName}:`, err);
            setCloudStatus(prev => ({ ...prev, syncing: false, error: err.message }));
            throw err;
          }
        };
      };

      registerOutflowDelete('__deletePeople', 'deletePeople', { skipAutoSeed: true });
      registerOutflowDelete('__deletePeopleExpense', 'deletePeopleExpense', { skipAutoSeed: true });
      registerOutflowDelete('__deletePeopleFromSupabase', 'deletePeopleFromSupabase', { skipAutoSeed: true });
      registerOutflowDelete('__deletePeopleRow', 'deletePeopleRow', { skipAutoSeed: true });

      registerOutflowDelete('__deleteProjectCost', 'deleteProjectCost', { skipAutoSeed: true });
      registerOutflowDelete('__deleteProjectCostExpense', 'deleteProjectCostExpense', { skipAutoSeed: true });
      registerOutflowDelete('__deleteProjectCostFromSupabase', 'deleteProjectCostFromSupabase', { skipAutoSeed: true });
      registerOutflowDelete('__deleteProjectCostRow', 'deleteProjectCostRow', { skipAutoSeed: true });

      registerOutflowDelete('__deleteCapex', 'deleteCapex', { skipAutoSeed: true });
      registerOutflowDelete('__deleteCapexExpense', 'deleteCapexExpense', { skipAutoSeed: true });
      registerOutflowDelete('__deleteCapexFromSupabase', 'deleteCapexFromSupabase', { skipAutoSeed: true });
      registerOutflowDelete('__deleteCapexRow', 'deleteCapexRow', { skipAutoSeed: true });

      registerOutflowDelete('__deleteFinancingAndOwner', 'deleteFinancingAndOwner', { skipAutoSeed: true });
      registerOutflowDelete('__deleteFinancingAndOwnerExpense', 'deleteFinancingAndOwnerExpense', { skipAutoSeed: true });
      registerOutflowDelete('__deleteFinancingAndOwnerFromSupabase', 'deleteFinancingAndOwnerFromSupabase', { skipAutoSeed: true });
      registerOutflowDelete('__deleteFinancingAndOwnerRow', 'deleteFinancingAndOwnerRow', { skipAutoSeed: true });

      registerOutflowDelete('__deleteOfficeFixed', 'deleteOfficeFixed', { skipAutoSeed: true });
      registerOutflowDelete('__deleteOfficeFixedExpense', 'deleteOfficeFixedExpense', { skipAutoSeed: true });
      registerOutflowDelete('__deleteOfficeFixedFromSupabase', 'deleteOfficeFixedFromSupabase', { skipAutoSeed: true });
      registerOutflowDelete('__deleteOfficeFixedRow', 'deleteOfficeFixedRow', { skipAutoSeed: true });

      registerOutflowDelete('__deleteOfficeVariable', 'deleteOfficeVariable', { skipAutoSeed: true });
      registerOutflowDelete('__deleteOfficeVariableExpense', 'deleteOfficeVariableExpense', { skipAutoSeed: true });
      registerOutflowDelete('__deleteOfficeVariableFromSupabase', 'deleteOfficeVariableFromSupabase', { skipAutoSeed: true });
      registerOutflowDelete('__deleteOfficeVariableRow', 'deleteOfficeVariableRow', { skipAutoSeed: true });

      registerOutflowDelete('__deleteTravel', 'deleteTravel', { skipAutoSeed: true });
      registerOutflowDelete('__deleteTravelExpense', 'deleteTravelExpense', { skipAutoSeed: true });
      registerOutflowDelete('__deleteTravelFromSupabase', 'deleteTravelFromSupabase', { skipAutoSeed: true });
      registerOutflowDelete('__deleteTravelRow', 'deleteTravelRow', { skipAutoSeed: true });

      registerOutflowDelete('__deleteProfessionalAdmin', 'deleteProfessionalAdmin', { skipAutoSeed: true, markProfessionalAdminConfigured: true });
      registerOutflowDelete('__deleteProfessionalAdminExpense', 'deleteProfessionalAdminExpense', { skipAutoSeed: true, markProfessionalAdminConfigured: true });
      registerOutflowDelete('__deleteProfessionalAdminFromSupabase', 'deleteProfessionalAdminFromSupabase', { skipAutoSeed: true, markProfessionalAdminConfigured: true });
      registerOutflowDelete('__deleteProfessionalAdminRow', 'deleteProfessionalAdminRow', { skipAutoSeed: true, markProfessionalAdminConfigured: true });

      registerOutflowDelete('__deleteOperationCost', 'deleteOperationCost', { skipAutoSeed: true });
      registerOutflowDelete('__deleteOperationCostExpense', 'deleteOperationCostExpense', { skipAutoSeed: true });
      registerOutflowDelete('__deleteOperationCostFromSupabase', 'deleteOperationCostFromSupabase', { skipAutoSeed: true });
      registerOutflowDelete('__deleteOperationCostRow', 'deleteOperationCostRow', { skipAutoSeed: true });

      registerOutflowDelete('__deleteTaxStatutory', 'deleteTaxStatutory', { skipAutoSeed: true });
      registerOutflowDelete('__deleteTaxStatutoryExpense', 'deleteTaxStatutoryExpense', { skipAutoSeed: true });
      registerOutflowDelete('__deleteTaxStatutoryFromSupabase', 'deleteTaxStatutoryFromSupabase', { skipAutoSeed: true });
      registerOutflowDelete('__deleteTaxStatutoryRow', 'deleteTaxStatutoryRow', { skipAutoSeed: true });

      registerOutflowDelete('__deleteOfficeTravel', 'deleteOfficeTravel', { skipAutoSeed: true });
      registerOutflowDelete('__deleteOfficeTravelExpense', 'deleteOfficeTravelExpense', { skipAutoSeed: true });
      registerOutflowDelete('__deleteOfficeTravelFromSupabase', 'deleteOfficeTravelFromSupabase', { skipAutoSeed: true });
      registerOutflowDelete('__deleteOfficeTravelRow', 'deleteOfficeTravelRow', { skipAutoSeed: true });

      registerOutflowDelete('__deleteOutflowRecord', 'deleteOutflowRecord', { skipAutoSeed: true });

      (window as any).openAddClientModal = () => setShowAddClientModal(true);
      (window as any).openAddVendorModal = () => setShowAddVendorModal(true);
      (window as any).openAddEmployeeModal = () => setShowAddEmployeeModal(true);
      (window as any).openAddOtherPartyModal = () => setShowAddOtherPartyModal(true);
      (window as any).openAddProjectModal = () => setShowAddProjectModal(true);
      (window as any).openAddDepartmentModal = () => setShowAddDepartmentModal(true);
      (window as any).openAddBankAccountModal = () => setShowAddBankAccountModal(true);
      (window as any).openAddCategoryModal = () => setShowAddCategoryModal(true);

      // 13. Check connection and load data from fss tables
      if (isSupabaseConfigured) {
        const isConn = await SupabaseService.testConnection();
        if (mounted) {
          setCloudStatus(prev => ({ ...prev, connected: isConn }));
        }

        if (isConn) {
          try {
            await refreshSupabaseAuditLogs();
            auditRealtimeChannel = SupabaseService.subscribeToAuditLogs(
              (event: any) => {
                if (!Store.data) return;
                if (event.eventType === 'DELETE') {
                  const deletedId = String(event.old?.id || '');
                  Store.data.audit = Store.data.audit.filter((row: any) => String(row.id) !== deletedId);
                } else if (event.new) {
                  const row = SupabaseService.mapAuditLogRow(event.new);
                  Store.data.audit = [row, ...Store.data.audit.filter((item: any) => item.id !== row.id)]
                    .sort((a: any, b: any) => String(b.ts || '').localeCompare(String(a.ts || '')));
                }
                render({ keepScroll: true });
              },
              (status: string) => {
                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                  const message = `Supabase audit log realtime subscription failed (${status}).`;
                  console.error(message);
                  setCloudStatus(prev => ({ ...prev, error: message }));
                }
              }
            );
          } catch (auditError: any) {
            console.error('Could not initialize Supabase audit log:', auditError);
            setCloudStatus(prev => ({
              ...prev,
              error: auditError?.message || 'Could not load the Supabase audit log.'
            }));
          }
          isHydratingSupabase.current = true;
          try {
            await Promise.all([
              loadSupabaseClients(),
              loadSupabaseDepartments()
            ]);
            await Promise.all([
              loadSupabaseVendors(),
              loadSupabaseEmployees(),
              loadSupabaseOtherParties(),
              loadSupabaseProjects(),
              loadSupabaseBankAccounts(),
              loadSupabaseCategories(),
              loadSupabaseOrders(),
              loadSupabaseTransactions()
            ]);
            await loadSupabaseCashflowTables();
          } finally {
            isHydratingSupabase.current = false;
          }
        }
      }
    };

    init();

    return () => {
      mounted = false;
      SupabaseService.removeAuditLogSubscription(auditRealtimeChannel);
      if (cashflowDebounceTimer) clearTimeout(cashflowDebounceTimer);
      delete (window as any).__writeSupabaseAuditLog;
      delete (window as any).__refreshSupabaseAuditLogs;
      delete (window as any).__supabaseDeleteAuditLog;
      delete (window as any).__onCashflowDataChanged;
      delete (window as any).__reportAccountSummarySyncError;
      delete (window as any).__supabaseSaveClient;
      delete (window as any).__supabaseDeleteClient;
      delete (window as any).__supabaseSaveVendor;
      delete (window as any).__supabaseDeleteVendor;
      delete (window as any).__supabaseSavePayVendorEntry;
      delete (window as any).__fssQueryTransactions;
      delete (window as any).__fssDeleteTransaction;
      delete (window as any).__fssOpenTransactionModal;
      delete (window as any).__computeByAccountCreditedDebitedRows;
      delete (window as any).__supabaseLoadPayVendorEntries;
      delete (window as any).__supabaseUpdatePayVendorEntry;
      delete (window as any).__supabaseDeletePayVendorEntry;
      delete (window as any).__supabaseUploadPayVendorAttachments;
      delete (window as any).__supabaseDeletePayVendorAttachments;
      delete (window as any).__supabaseUploadFormAttachments;
      delete (window as any).__supabaseDeleteFormAttachments;
      delete (window as any).__supabaseSavePayEmployeeEntry;
      delete (window as any).__supabaseLoadPayEmployeeEntries;
      delete (window as any).__supabaseSaveTaxStatutoryEntry;
      delete (window as any).__supabaseLoadTaxStatutoryEntries;
      delete (window as any).__supabaseDeleteTaxStatutoryEntry;
      delete (window as any).__supabaseSaveOtherExpenseEntry;
      delete (window as any).__supabaseLoadOtherExpenseEntries;
      delete (window as any).__supabaseDeleteOtherExpenseEntry;
      delete (window as any).__supabaseSaveClientPaymentEntry;
      delete (window as any).__supabaseLoadClientPaymentEntries;
      delete (window as any).__supabaseDeleteClientPaymentEntry;
      delete (window as any).__supabaseUploadOtherIncomeAttachments;
      delete (window as any).__supabaseDeleteOtherIncomeAttachments;
      delete (window as any).__supabaseSaveOtherIncomeEntry;
      delete (window as any).__supabaseLoadOtherIncomeEntries;
      delete (window as any).__supabaseDeleteOtherIncomeEntry;
      delete (window as any).__supabaseSaveEmployee;
      delete (window as any).__supabaseDeleteEmployee;
      delete (window as any).__supabaseSaveOtherParty;
      delete (window as any).__supabaseDeleteOtherParty;
      delete (window as any).__supabaseSaveProject;
      delete (window as any).__supabaseDeleteProject;
      delete (window as any).__supabaseSaveDepartment;
      delete (window as any).__supabaseDeleteDepartment;
      delete (window as any).__supabaseSaveBankAccount;
      delete (window as any).__supabaseDeleteBankAccount;
      delete (window as any).__supabaseSaveCategory;
      delete (window as any).__supabaseDeleteCategory;
      delete (window as any).__supabaseSaveOrder;
      delete (window as any).__supabaseDeleteOrder;
      delete (window as any).__supabaseSaveTransaction;
      delete (window as any).__supabaseCancelTransaction;
      delete (window as any).__supabaseDeleteTransaction;
      delete (window as any).__supabaseRefreshAfterTransactionPurge;
      delete (window as any).__supabaseSaveAccountTransfer;
      delete (window as any).__supabaseSetAccountTransferDeleted;
      delete (window as any).__supabaseSyncCashflowInflow;
      delete (window as any).__supabaseFetchCashflowInflow;
      delete (window as any).__updateOperationReceiptCell;
      delete (window as any).__addOperationReceipt;
      delete (window as any).__updateIncomeCell;
      delete (window as any).__addIncome;
      delete (window as any).__updateFinancingCell;
      delete (window as any).__addFinancing;
      delete (window as any).__updatePeopleCell;
      delete (window as any).__addPeopleExpense;
      delete (window as any).__updateProjectCostCell;
      delete (window as any).__addProjectCostExpense;
      delete (window as any).__updateTaxStatutoryCell;
      delete (window as any).__addTaxStatutoryExpense;
      delete (window as any).__updateTravelCell;
      delete (window as any).__addTravelExpense;
      delete (window as any).__updateProfessionalAdminCell;
      delete (window as any).__addProfessionalAdminExpense;
      delete (window as any).__updateOfficeFixedCell;
      delete (window as any).__addOfficeFixedExpense;
      delete (window as any).__updateOfficeVariableCell;
      delete (window as any).__addOfficeVariableExpense;
      delete (window as any).__loadByAccountCreditedDebited;
      delete (window as any).__updateByAccountCreditedDebitedCell;
      delete (window as any).__updateAccountBalanceCell;
      delete (window as any).__insertByAccountCreditedDebited;
      delete (window as any).__deleteByAccountCreditedDebited;
      delete (window as any).__syncByAccountCreditedDebited;
      delete (window as any).__syncByAccountTransfer;

      // Clean up outflow delete handlers
      const outflowDeleteNames = [
        '__deletePeople', '__deletePeopleExpense', '__deletePeopleFromSupabase', '__deletePeopleRow',
        '__deleteProjectCost', '__deleteProjectCostExpense', '__deleteProjectCostFromSupabase', '__deleteProjectCostRow',
        '__deleteCapex', '__deleteCapexExpense', '__deleteCapexFromSupabase', '__deleteCapexRow',
        '__deleteFinancingAndOwner', '__deleteFinancingAndOwnerExpense', '__deleteFinancingAndOwnerFromSupabase', '__deleteFinancingAndOwnerRow',
        '__deleteOfficeFixed', '__deleteOfficeFixedExpense', '__deleteOfficeFixedFromSupabase', '__deleteOfficeFixedRow',
        '__deleteOfficeVariable', '__deleteOfficeVariableExpense', '__deleteOfficeVariableFromSupabase', '__deleteOfficeVariableRow',
        '__deleteTravel', '__deleteTravelExpense', '__deleteTravelFromSupabase', '__deleteTravelRow',
        '__deleteProfessionalAdmin', '__deleteProfessionalAdminExpense', '__deleteProfessionalAdminFromSupabase', '__deleteProfessionalAdminRow',
        '__deleteOperationCost', '__deleteOperationCostExpense', '__deleteOperationCostFromSupabase', '__deleteOperationCostRow',
        '__deleteTaxStatutory', '__deleteTaxStatutoryExpense', '__deleteTaxStatutoryFromSupabase', '__deleteTaxStatutoryRow',
        '__deleteOfficeTravel', '__deleteOfficeTravelExpense', '__deleteOfficeTravelFromSupabase', '__deleteOfficeTravelRow',
        '__deleteOutflowRecord'
      ];
      outflowDeleteNames.forEach(n => delete (window as any)[n]);
      delete (window as any).openAddClientModal;
      delete (window as any).openAddVendorModal;
      delete (window as any).openAddEmployeeModal;
      delete (window as any).openAddOtherPartyModal;
      delete (window as any).openAddProjectModal;
      delete (window as any).openAddDepartmentModal;
      delete (window as any).openAddBankAccountModal;
      delete (window as any).openAddCategoryModal;
    };
  }, [loadSupabaseClients, loadSupabaseVendors, loadSupabaseEmployees, loadSupabaseOtherParties, loadSupabaseProjects, loadSupabaseDepartments, loadSupabaseBankAccounts, loadSupabaseCategories, loadSupabaseOrders, loadSupabaseTransactions, loadSupabaseCashflowTables]);

  return (
    <>
      <div className="app">
        <aside className="sidebar" id="sidebar">
          <div className="brand">
            <div className="brand-mark">IU</div>
            <div>
              <div className="brand-name">IUOVA</div>
              <div className="brand-sub">Cashflow · v2</div>
            </div>
          </div>
          <nav className="nav" id="nav"></nav>
          <div className="side-foot" id="sideFoot"></div>
        </aside>

        <main className="main">
          <header className="topbar">
            <button className="icon-btn menu-btn" id="menuBtn" aria-label="Menu"></button>
            <h1 id="pageTitle">Dashboard</h1>

            <div className="top-actions">
              {/* Cloud Sync Status Indicator */}
              <button
                type="button"
                className={`cloud-sync-pill ${cloudStatus.connected ? 'online' : cloudStatus.configured ? 'offline' : 'local'}`}
                onClick={() => setShowCloudModal(true)}
                title={
                  cloudStatus.connected
                    ? `Supabase Connected · ${cloudStatus.clientCount ?? 0} clients, ${cloudStatus.vendorCount ?? 0} vendors, ${cloudStatus.transactionCount ?? 0} transactions, ${cloudStatus.orderCount ?? 0} orders · Last synced: ${cloudStatus.lastSynced || 'Just now'}`
                    : cloudStatus.configured
                    ? 'Supabase Configured (Connecting...)'
                    : 'Local Mode (Click to connect Supabase)'
                }
              >
                <span className="cloud-dot"></span>
                <span className="cloud-label">
                  {cloudStatus.syncing
                    ? 'Syncing...'
                    : cloudStatus.connected
                    ? `Supabase (${cloudStatus.transactionCount ?? 0} txns · ${cloudStatus.orderCount ?? 0} orders · ${cloudStatus.clientCount ?? 0} clients · ${cloudStatus.vendorCount ?? 0} vendors)`
                    : cloudStatus.configured
                    ? 'Connecting'
                    : 'Local Mode'}
                </span>
              </button>

              <select className="select sel-sm" id="fySelect" aria-label="Financial year"></select>
              <select className="select sel-sm user-sel" id="userSelect" aria-label="Logged in as"></select>
              <button className="btn btn-gold btn-add" id="addBtn"></button>
            </div>
          </header>

          <div className="view" id="view"></div>
        </main>
      </div>

      <nav className="bottom-nav" id="bottomNav"></nav>
      <button className="fab" id="fab" aria-label="Add entry"></button>
      <div id="layer"></div>
      <div className="toasts" id="toasts"></div>

      {/* Supabase Connection Modal */}
      {showCloudModal && (
        <div className="drawer-ov" onClick={() => setShowCloudModal(false)}>
          <div className="modal" style={{ maxWidth: '520px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-h">
              <h2>Supabase Cloud Database</h2>
              <button className="icon-btn xs" onClick={() => setShowCloudModal(false)} aria-label="Close">
                ✕
              </button>
            </div>
            <div className="modal-b stack">
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div
                  style={{
                    width: '12px',
                    height: '12px',
                    borderRadius: '50%',
                    backgroundColor: cloudStatus.connected ? '#1E7A4F' : cloudStatus.configured ? '#EBA937' : '#7B8396'
                  }}
                />
                <div>
                  <strong>
                    {cloudStatus.connected
                      ? `Connected (${cloudStatus.transactionCount ?? 0} transactions, ${cloudStatus.orderCount ?? 0} orders, ${cloudStatus.clientCount ?? 0} clients, ${cloudStatus.vendorCount ?? 0} vendors)`
                      : cloudStatus.configured
                      ? 'Connecting to Supabase...'
                      : 'Running in Local Mode'}
                  </strong>
                  <div className="sub" style={{ fontSize: '12px', color: 'var(--muted)' }}>
                    {cloudStatus.lastSynced ? `Last synchronized at ${cloudStatus.lastSynced}` : 'Local data persistence'}
                  </div>
                </div>
              </div>

              {cloudStatus.error && (
                <div className="notice warn" style={{ fontSize: '12px', color: 'var(--out)' }}>
                  {cloudStatus.error}
                </div>
              )}

              <div className="card" style={{ padding: '14px', background: 'var(--surface-2)', fontSize: '13px' }}>
                <strong>Table Integration</strong>
                <p style={{ marginTop: '6px', color: 'var(--ink-2)', lineHeight: '1.5' }}>
                  Transactions: <code>fss_table_transactions</code>.<br />
                  Orders: <code>fss_table_orders</code>, <code>fss_table_order_departments</code>, <code>fss_table_order_milestones</code>, <code>fss_table_order_documents</code>.<br />
                  Clients: <code>fss_client</code> &amp; <code>fss_client_people</code>.<br />
                  Vendors: <code>fss_vendor</code> &amp; <code>fss_vendor_people</code>.<br />
                  Employees: <code>fss_employe</code>.<br />
                  Other Parties: <code>fss_other_parties</code>.<br />
                  Projects: <code>fss_projects</code>.<br />
                  Departments: <code>fss_departments</code>.<br />
                  Bank Accounts: <code>fss_bank_accounts</code>.<br />
                  Categories: <code>fss_categories</code>.<br />
                  Cashflow Inflow: <code>fss_operation_receipts</code> ({cloudStatus.operationReceiptCount ?? '—'}), <code>fss_income</code> ({cloudStatus.incomeCount ?? '—'}), <code>fss_financing</code> ({cloudStatus.financingCount ?? '—'}), <code>fss_cash_inflow</code> ({cloudStatus.cashInflowCount ?? '—'}).<br />
                  People Outflow: <code>fss_outflow_oc_people</code> ({cloudStatus.peopleCount ?? '—'}), <code>fss_outflow_oc_people_report</code> (View).
                </p>
                <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--muted)' }}>
                  Target tables: <code>public.fss_operation_receipts</code>, <code>public.fss_income</code>, <code>public.fss_financing</code>, <code>public.fss_cash_inflow</code>, <code>public.fss_outflow_oc_people</code>, <code>public.fss_table_transactions</code>, <code>public.fss_table_orders</code>, <code>public.fss_client</code>, <code>public.fss_vendor</code>, <code>public.fss_employe</code>, <code>public.fss_other_parties</code>, <code>public.fss_projects</code>, <code>public.fss_departments</code>, <code>public.fss_bank_accounts</code>, <code>public.fss_categories</code>
                </div>
              </div>

              <div className="row" style={{ justifyContent: 'flex-end', gap: '8px', marginTop: '10px' }}>
                {isSupabaseConfigured && (
                  <button
                    type="button"
                    className="btn btn-navy"
                    disabled={cloudStatus.syncing}
                    onClick={() => refreshAllFromSupabase()}
                  >
                    {cloudStatus.syncing ? 'Syncing...' : 'Refresh from Supabase'}
                  </button>
                )}
                <button type="button" className="btn" onClick={() => setShowCloudModal(false)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* React Add Client Modal */}
      <AddClientModal
        isOpen={showAddClientModal}
        onClose={() => setShowAddClientModal(false)}
        onSuccess={handleClientAdded}
      />

      {/* React Add Vendor Modal */}
      <AddVendorModal
        isOpen={showAddVendorModal}
        onClose={() => setShowAddVendorModal(false)}
        onSuccess={handleVendorAdded}
      />

      {/* React Add Employee Modal */}
      <AddEmployeeModal
        isOpen={showAddEmployeeModal}
        onClose={() => setShowAddEmployeeModal(false)}
        onSuccess={handleEmployeeAdded}
        departments={Store.data?.departments || []}
      />

      {/* React Add Other Party Modal */}
      <AddOtherPartyModal
        isOpen={showAddOtherPartyModal}
        onClose={() => setShowAddOtherPartyModal(false)}
        onSuccess={handleOtherPartyAdded}
      />

      {/* React Add Project Modal */}
      <AddProjectModal
        isOpen={showAddProjectModal}
        onClose={() => setShowAddProjectModal(false)}
        onSuccess={handleProjectAdded}
        clients={Store.data?.parties || []}
        departments={Store.data?.departments || []}
      />

      {/* React Add Department Modal */}
      <AddDepartmentModal
        isOpen={showAddDepartmentModal}
        onClose={() => setShowAddDepartmentModal(false)}
        onSuccess={handleDepartmentAdded}
      />

      {/* React Add Bank Account Modal */}
      <AddBankAccountModal
        isOpen={showAddBankAccountModal}
        onClose={() => setShowAddBankAccountModal(false)}
        onSuccess={handleBankAccountAdded}
      />

      {/* React Add Category Modal */}
      <AddCategoryModal
        isOpen={showAddCategoryModal}
        onClose={() => setShowAddCategoryModal(false)}
        onSuccess={handleCategoryAdded}
      />
      {isFssTransactionModalOpen && (
        <SupabaseTransactionModal
          transaction={fssTransactionToEdit}
          categories={Store.data?.categories || []}
          parties={Store.data?.parties || []}
          projects={Store.data?.projects || []}
          departments={Store.data?.departments || []}
          accounts={Store.data?.accounts || []}
          paymentModes={PAYMENT_MODES}
          onClose={() => {
            setIsFssTransactionModalOpen(false);
            setFssTransactionToEdit(null);
          }}
          onSave={async (id: string | null, input: FssTransactionInput) => {
            let savedRow: any = null;
            if (id) {
              savedRow = await SupabaseService.updateFssTransaction(id, input);
            } else {
              savedRow = await SupabaseService.createFssTransaction(input);
            }
            if (savedRow && Store.data?.entries) {
              const localEntry = convertFssTransactionToLocal(
                savedRow,
                Store.data.entries,
                Store.data.parties || [],
                Store.data.projects || [],
                Store.data.departments || [],
                Store.data.categories || [],
                Store.data.accounts || []
              );
              const priorId = fssTransactionToEdit?.id;
              const exIdx = Store.data.entries.findIndex((e: any) =>
                (e.supabase_id && e.supabase_id === savedRow.id) ||
                e.id === savedRow.id ||
                (priorId && (e.id === priorId || e.supabase_id === priorId || e.supabase_fss_transaction_id === priorId))
              );
              if (exIdx >= 0) {
                Store.data.entries[exIdx] = { ...Store.data.entries[exIdx], ...localEntry, id: Store.data.entries[exIdx].id };
              } else {
                Store.data.entries.unshift(localEntry);
              }
              Store.persist();
              void syncCreditedDebitedFromEntries(Store.data.entries);
            }
            setIsFssTransactionModalOpen(false);
            setFssTransactionToEdit(null);
            setCloudStatus(prev => ({
              ...prev,
              transactionCount: (prev.transactionCount || 0) + (id ? 0 : 1),
              lastSynced: new Date().toLocaleTimeString(),
              error: null
            }));
            (window as any).IuovaCore?.toast(id ? 'Transaction updated in Supabase' : 'Transaction saved to Supabase');
            await (window as any).__refreshSupabaseAuditLogs?.();
            await (window as any).IuovaCore?.refreshLedgerFromSupabase?.();
          }}
        />
      )}
    </>
  );
};

export default App;
