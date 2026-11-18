import React, { useState, useCallback } from 'react';
import { SupabaseService } from '../lib/supabase';

export interface AddBankAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (newAccount: any) => void;
}

export const AddBankAccountModal: React.FC<AddBankAccountModalProps> = ({
  isOpen,
  onClose,
  onSuccess
}) => {
  const [formData, setFormData] = useState({
    account_name: '',
    account_type: 'Bank',
    account_number_masked: '',
    opening_balance: '0',
    opening_balance_date: '2025-04-01'
  });

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setFormData({
      account_name: '',
      account_type: 'Bank',
      account_number_masked: '',
      opening_balance: '0',
      opening_balance_date: '2025-04-01'
    });
    setErrorMessage(null);
    setIsSubmitting(false);
  }, []);

  if (!isOpen) return null;

  const handleModalClose = () => {
    if (isSubmitting) return;
    resetForm();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const name = formData.account_name.trim();
    if (!name) {
      setErrorMessage('Account name is required.');
      return;
    }

    const openingBal = parseFloat(formData.opening_balance);
    if (isNaN(openingBal)) {
      setErrorMessage('Please enter a valid opening balance.');
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await SupabaseService.saveBankAccount({
        account_name: name,
        account_type: formData.account_type,
        account_number_masked: formData.account_number_masked.trim() || null,
        opening_balance: openingBal,
        opening_balance_date: formData.opening_balance_date || '2025-04-01'
      });

      if (res) {
        if (onSuccess) onSuccess(res);
        resetForm();
        onClose();
      }
    } catch (err: any) {
      console.error('Error saving bank account to Supabase:', err);
      setErrorMessage(err.message || 'Failed to save bank account to Supabase.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="drawer-ov"
      onClick={handleModalClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-acc-title"
      style={{ zIndex: 1000 }}
    >
      <div
        className="modal"
        style={{ maxWidth: '520px', width: '92%' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="modal-h" style={{ justifyContent: 'space-between' }}>
          <div>
            <h2 id="add-acc-title" style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>
              Add bank account
            </h2>
            <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>
              Create a new bank account and sync to Supabase (<code>fss_bank_accounts</code>)
            </div>
          </div>
          <button
            type="button"
            className="icon-btn xs"
            onClick={handleModalClose}
            aria-label="Close modal"
            disabled={isSubmitting}
          >
            ✕
          </button>
        </div>

        {/* Global Error Banner */}
        {errorMessage && (
          <div style={{ padding: '10px 20px 0 20px' }}>
            <div
              className="notice"
              style={{
                background: 'var(--out-soft)',
                borderColor: '#EBC9C0',
                color: 'var(--out)'
              }}
            >
              <span>{errorMessage}</span>
            </div>
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleSubmit} id="addBankAccountForm">
          <div className="modal-b stack" style={{ gap: '14px', maxHeight: '70vh' }}>
            <div className="field">
              <label htmlFor="acc_name" className="lbl">
                Account Name <span style={{ color: 'var(--out)' }}>*</span>
              </label>
              <input
                id="acc_name"
                type="text"
                required
                className="input"
                placeholder="e.g. Axis Bank – Current"
                value={formData.account_name}
                onChange={(e) => setFormData(prev => ({ ...prev, account_name: e.target.value }))}
                autoFocus
              />
            </div>

            <div className="row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="field">
                <label htmlFor="acc_type" className="lbl">Account Type</label>
                <select
                  id="acc_type"
                  className="select"
                  value={formData.account_type}
                  onChange={(e) => setFormData(prev => ({ ...prev, account_type: e.target.value }))}
                >
                  <option value="Bank">Bank</option>
                  <option value="Fixed deposit">Fixed deposit</option>
                  <option value="Cash">Cash</option>
                </select>
              </div>

              <div className="field">
                <label htmlFor="acc_number" className="lbl">Account No. (Masked)</label>
                <input
                  id="acc_number"
                  type="text"
                  className="input"
                  placeholder="e.g. ••9821"
                  value={formData.account_number_masked}
                  onChange={(e) => setFormData(prev => ({ ...prev, account_number_masked: e.target.value }))}
                />
              </div>
            </div>

            <div className="row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="field">
                <label htmlFor="acc_balance" className="lbl">Opening Balance (₹)</label>
                <input
                  id="acc_balance"
                  type="number"
                  step="0.01"
                  className="input"
                  placeholder="0.00"
                  value={formData.opening_balance}
                  onChange={(e) => setFormData(prev => ({ ...prev, opening_balance: e.target.value }))}
                />
              </div>

              <div className="field">
                <label htmlFor="acc_balance_date" className="lbl">Opening Balance Date</label>
                <input
                  id="acc_balance_date"
                  type="date"
                  className="input"
                  value={formData.opening_balance_date}
                  onChange={(e) => setFormData(prev => ({ ...prev, opening_balance_date: e.target.value }))}
                />
              </div>
            </div>
          </div>

          {/* Modal Footer */}
          <div className="modal-f" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '14px 20px' }}>
            <button
              type="button"
              className="btn"
              onClick={handleModalClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-gold"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Saving to Supabase...' : 'Save Account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
