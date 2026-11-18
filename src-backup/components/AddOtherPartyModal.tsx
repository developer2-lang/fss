import React, { useState, useCallback } from 'react';
import { SupabaseService } from '../lib/supabase';

export interface AddOtherPartyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (newOtherParty: any) => void;
}

const GST_TYPE_OPTIONS = [
  'No GST',
  'Regular GST',
  'Composition GST',
  'Unregistered'
];

export const AddOtherPartyModal: React.FC<AddOtherPartyModalProps> = ({
  isOpen,
  onClose,
  onSuccess
}) => {
  const [formData, setFormData] = useState({
    name: '',
    gstin: '',
    default_gst_type: 'No GST',
    emails: '',
    phone: '',
    is_active: true
  });

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setFormData({
      name: '',
      gstin: '',
      default_gst_type: 'No GST',
      emails: '',
      phone: '',
      is_active: true
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

    const name = formData.name.trim();
    if (!name) {
      setErrorMessage('Party name is required.');
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await SupabaseService.saveOtherParty({
        name,
        gstin: formData.gstin.trim(),
        default_gst_type: formData.default_gst_type,
        emails: formData.emails.trim(),
        phone: formData.phone.trim(),
        is_active: formData.is_active
      });

      if (res) {
        if (onSuccess) onSuccess(res);
        resetForm();
        onClose();
      }
    } catch (err: any) {
      console.error('Error saving other party to Supabase:', err);
      setErrorMessage(err.message || 'Failed to save other party to Supabase.');
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
      aria-labelledby="add-other-party-title"
      style={{ zIndex: 1000 }}
    >
      <div
        className="modal"
        style={{ maxWidth: '540px', width: '92%' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="modal-h" style={{ justifyContent: 'space-between' }}>
          <div>
            <h2 id="add-other-party-title" style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>
              Add other party
            </h2>
            <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>
              Create an other party profile and sync to Supabase (<code>fss_other_parties</code>)
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
        <form onSubmit={handleSubmit} id="addOtherPartyForm">
          <div className="modal-b stack" style={{ gap: '14px', maxHeight: '70vh' }}>
            <div className="field">
              <label htmlFor="op_name" className="lbl">
                Party Name <span style={{ color: 'var(--out)' }}>*</span>
              </label>
              <input
                id="op_name"
                type="text"
                required
                className="input"
                placeholder="e.g. GST Department (Govt.), HDFC Bank, etc."
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                autoFocus
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="field">
                <label htmlFor="op_gstin" className="lbl">GSTIN</label>
                <input
                  id="op_gstin"
                  type="text"
                  className="input mono"
                  placeholder="27AAACH2702H1ZX"
                  value={formData.gstin}
                  onChange={(e) => setFormData(prev => ({ ...prev, gstin: e.target.value.toUpperCase() }))}
                />
              </div>

              <div className="field">
                <label htmlFor="op_gst_type" className="lbl">Default GST Type</label>
                <select
                  id="op_gst_type"
                  className="select"
                  value={formData.default_gst_type}
                  onChange={(e) => setFormData(prev => ({ ...prev, default_gst_type: e.target.value }))}
                >
                  {GST_TYPE_OPTIONS.map(opt => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="field">
              <label htmlFor="op_emails" className="lbl">Emails</label>
              <input
                id="op_emails"
                type="text"
                className="input"
                placeholder="Separate several with commas"
                value={formData.emails}
                onChange={(e) => setFormData(prev => ({ ...prev, emails: e.target.value }))}
              />
              <div className="hint" style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>
                Used for payment advices, tax challan records, receipts and PIs.
              </div>
            </div>

            <div className="field">
              <label htmlFor="op_phone" className="lbl">Phone</label>
              <input
                id="op_phone"
                type="tel"
                className="input"
                placeholder="e.g. +91 98765 43210"
                value={formData.phone}
                onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
              />
            </div>

            <div className="field" style={{ marginTop: '4px' }}>
              <label className="check" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={formData.is_active}
                  onChange={(e) => setFormData(prev => ({ ...prev, is_active: e.target.checked }))}
                />
                <span>Active party (available for entries &amp; cashflow records)</span>
              </label>
            </div>
          </div>

          {/* Modal Footer */}
          <div className="modal-f" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
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
              {isSubmitting ? 'Saving to Supabase...' : 'Save Other Party'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddOtherPartyModal;
