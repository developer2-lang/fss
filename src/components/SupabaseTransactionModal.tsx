import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import { FssTransactionInput } from '../lib/supabase';

interface TransactionOption {
  id: string;
  name: string;
  type?: string;
  active?: boolean;
}

interface SupabaseTransactionModalProps {
  transaction: any | null;
  categories: TransactionOption[];
  parties: TransactionOption[];
  projects: TransactionOption[];
  departments: TransactionOption[];
  accounts: TransactionOption[];
  paymentModes: string[];
  onClose: () => void;
  onSave: (id: string | null, input: FssTransactionInput) => Promise<void>;
}

interface TransactionForm {
  transaction_date: string;
  type: 'Inflow' | 'Outflow';
  category: string;
  description: string;
  reference_no: string;
  party: string;
  project: string;
  department: string;
  taxable_amount: string;
  gst_amount: string;
  tds_amount: string;
  account: string;
  mode: string;
  notes: string;
}

const today = () => new Date().toISOString().slice(0, 10);

function formFromTransaction(transaction: any | null): TransactionForm {
  return {
    transaction_date: transaction?.transaction_date || today(),
    type: String(transaction?.type || 'Outflow').toLowerCase() === 'inflow' ? 'Inflow' : 'Outflow',
    category: transaction?.category || '',
    description: transaction?.description || '',
    reference_no: transaction?.reference_no || '',
    party: transaction?.party || '',
    project: transaction?.project || '',
    department: transaction?.department || '',
    taxable_amount: transaction?.taxable_amount == null ? '' : String(transaction.taxable_amount),
    gst_amount: transaction?.gst_amount == null ? '0' : String(transaction.gst_amount),
    tds_amount: transaction?.tds_amount == null ? '0' : String(transaction.tds_amount),
    account: transaction?.account || '',
    mode: transaction?.mode || '',
    notes: transaction?.notes || ''
  };
}

export const SupabaseTransactionModal: React.FC<SupabaseTransactionModalProps> = ({
  transaction,
  categories,
  parties,
  projects,
  departments,
  accounts,
  paymentModes,
  onClose,
  onSave
}) => {
  const [form, setForm] = useState<TransactionForm>(() => formFromTransaction(transaction));
  const [errorMessage, setErrorMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setForm(formFromTransaction(transaction));
    setErrorMessage('');
    setIsSaving(false);
  }, [transaction]);

  const availableCategories = useMemo(() => {
    const active = categories.filter(category => category.active !== false);
    const matching = active.filter(category => !category.type || category.type.toLowerCase() === form.type.toLowerCase());
    if (form.category && !matching.some(category => category.name === form.category)) {
      const current = active.find(category => category.name === form.category);
      return current ? [...matching, current] : matching;
    }
    return matching;
  }, [categories, form.category, form.type]);

  const setField = (field: keyof TransactionForm, value: string) => {
    setForm(current => ({ ...current, [field]: value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage('');

    const taxable = Number(form.taxable_amount);
    const gst = Number(form.gst_amount || 0);
    const tds = Number(form.tds_amount || 0);
    if (!form.transaction_date || !form.type || !form.category || !form.description.trim() || !form.account || !form.mode) {
      setErrorMessage('Complete the date, type, category, description, bank account and payment mode.');
      return;
    }
    if (![taxable, gst, tds].every(value => Number.isFinite(value) && value >= 0)) {
      setErrorMessage('Amounts must be valid numbers greater than or equal to zero.');
      return;
    }

    const input: FssTransactionInput = {
      transaction_date: form.transaction_date,
      type: form.type,
      category: form.category,
      description: form.description.trim(),
      reference_no: form.reference_no.trim() || null,
      party: form.party || null,
      project: form.project || null,
      department: form.department || null,
      taxable_amount: taxable,
      gst_amount: gst,
      tds_amount: tds,
      account: form.account,
      mode: form.mode,
      notes: form.notes.trim() || null
    };

    setIsSaving(true);
    try {
      await onSave(transaction?.id || null, input);
      onClose();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not save this transaction.');
      setIsSaving(false);
    }
  };

  const field = (label: string, key: keyof TransactionForm, control: React.ReactNode, required = false) => (
    <div className="field">
      <label htmlFor={`fss-txn-${key}`}>{label}{required ? ' *' : ''}</label>
      {control}
    </div>
  );
  const input = (key: keyof TransactionForm, type = 'text', required = false) => (
    <input
      id={`fss-txn-${key}`}
      className="input"
      type={type}
      value={form[key]}
      onChange={event => setField(key, event.target.value)}
      required={required}
      disabled={isSaving}
      min={type === 'number' ? '0' : undefined}
      step={type === 'number' ? '0.01' : undefined}
    />
  );
  const select = (key: keyof TransactionForm, options: string[], required = false) => (
    <select
      id={`fss-txn-${key}`}
      className="select"
      value={form[key]}
      onChange={event => setField(key, event.target.value)}
      required={required}
      disabled={isSaving}
    >
      <option value="">Select</option>
      {options.map(option => <option value={option} key={option}>{option}</option>)}
    </select>
  );

  return (
    <div
      className="drawer-ov"
      role="dialog"
      aria-modal="true"
      aria-labelledby="fss-transaction-title"
      onClick={() => !isSaving && onClose()}
      style={{ zIndex: 1100 }}
    >
      <div className="modal" style={{ maxWidth: '780px', width: '94%' }} onClick={event => event.stopPropagation()}>
        <div className="modal-h" style={{ justifyContent: 'space-between' }}>
          <h2 id="fss-transaction-title" style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>
            {transaction ? 'Edit transaction' : 'Add transaction'}
          </h2>
          <button type="button" className="icon-btn xs" onClick={onClose} aria-label="Close" disabled={isSaving}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-b">
            {errorMessage && (
              <div className="notice" role="alert" style={{ marginBottom: '14px', color: 'var(--out)' }}>
                {errorMessage}
              </div>
            )}
            <div className="grid g-3">
              {field('Transaction date', 'transaction_date', input('transaction_date', 'date', true), true)}
              {field('Type', 'type', (
                <select
                  id="fss-txn-type"
                  className="select"
                  value={form.type}
                  onChange={event => {
                    setField('type', event.target.value);
                    setField('category', '');
                  }}
                  disabled={isSaving}
                >
                  <option value="Inflow">Inflow</option>
                  <option value="Outflow">Outflow</option>
                </select>
              ), true)}
              {field('Category', 'category', select('category', availableCategories.map(category => category.name), true), true)}
              {field('Description', 'description', input('description', 'text', true), true)}
              {field('Reference number', 'reference_no', input('reference_no'))}
              {field('Party', 'party', select('party', parties.filter(item => item.active !== false).map(item => item.name)))}
              {field('Project', 'project', select('project', projects.filter(item => item.active !== false).map(item => item.name)))}
              {field('Department', 'department', select('department', departments.filter(item => item.active !== false).map(item => item.name)))}
              {field('Taxable amount', 'taxable_amount', input('taxable_amount', 'number', true), true)}
              {field('GST amount', 'gst_amount', input('gst_amount', 'number'))}
              {field('TDS amount', 'tds_amount', input('tds_amount', 'number'))}
              {field('Bank account', 'account', select('account', accounts.filter(item => item.active !== false).map(item => item.name), true), true)}
              {field('Payment mode', 'mode', select('mode', paymentModes, true), true)}
              <div className="field span3">
                <label htmlFor="fss-txn-notes">Notes</label>
                <textarea
                  id="fss-txn-notes"
                  className="textarea"
                  rows={3}
                  value={form.notes}
                  onChange={event => setField('notes', event.target.value)}
                  disabled={isSaving}
                />
              </div>
            </div>
          </div>
          <div className="modal-f" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button type="button" className="btn" onClick={onClose} disabled={isSaving}>Cancel</button>
            <button type="submit" className="btn btn-navy" disabled={isSaving}>
              {isSaving ? 'Saving...' : transaction ? 'Save changes' : 'Save transaction'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
