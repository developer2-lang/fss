import React from 'react';
import { useAddVendorForm, TabType, PersonContact } from '../hooks/useAddVendorForm';

export interface AddVendorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (newVendor: any) => void;
}

const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
  'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram',
  'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
  'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Delhi', 'Chandigarh', 'Puducherry'
];

export const AddVendorModal: React.FC<AddVendorModalProps> = ({
  isOpen,
  onClose,
  onSuccess
}) => {
  const {
    formData,
    activeTab,
    setActiveTab,
    isSubmitting,
    errorMessage,
    handleFieldChange,
    handleAddPerson,
    handleRemovePerson,
    handlePersonChange,
    handleSubmit,
    resetForm
  } = useAddVendorForm({
    onSuccess,
    onClose
  });

  if (!isOpen) return null;

  const handleModalClose = () => {
    if (isSubmitting) return;
    resetForm();
    onClose();
  };

  return (
    <div
      className="drawer-ov"
      onClick={handleModalClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-vendor-title"
      style={{ zIndex: 1000 }}
    >
      <div
        className="modal"
        style={{ maxWidth: '780px', width: '92%' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="modal-h" style={{ justifyContent: 'space-between' }}>
          <div>
            <h2 id="add-vendor-title" style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>
              Add vendor
            </h2>
            <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>
              Create a new vendor profile in Supabase (fss_vendor &amp; fss_vendor_people)
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

        {/* Multi-Tab Navigation */}
        <div style={{ padding: '0 20px', borderBottom: '1px solid var(--line-2)' }}>
          <div className="tabs" style={{ marginBottom: 0, borderBottom: 'none' }}>
            <button
              type="button"
              className={activeTab === 'company' ? 'on' : ''}
              onClick={() => setActiveTab('company')}
            >
              Company
            </button>
            <button
              type="button"
              className={activeTab === 'people' ? 'on' : ''}
              onClick={() => setActiveTab('people')}
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              People ({formData.people.length})
            </button>
            <button
              type="button"
              className={activeTab === 'tax_bank' ? 'on' : ''}
              onClick={() => setActiveTab('tax_bank')}
            >
              Tax, terms &amp; bank
            </button>
          </div>
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
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{errorMessage}</span>
            </div>
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleSubmit} id="addVendorForm">
          <div className="modal-b" style={{ minHeight: '380px', maxHeight: '65vh' }}>
            {/* ============================================================== */}
            {/* TAB 1: COMPANY                                                 */}
            {/* ============================================================== */}
            {activeTab === 'company' && (
              <div className="stack" style={{ gap: '16px' }}>
                <div className="field">
                  <label htmlFor="vendor_name" className="lbl">
                    Vendor / Company Name <span style={{ color: 'var(--out)' }}>*</span>
                  </label>
                  <input
                    id="vendor_name"
                    type="text"
                    required
                    className="input"
                    placeholder="e.g. Acme Tech Solutions Pvt Ltd"
                    value={formData.vendor_name}
                    onChange={(e) => handleFieldChange('vendor_name', e.target.value)}
                    autoFocus
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div className="field">
                    <label htmlFor="vendor_gstin" className="lbl">GSTIN</label>
                    <input
                      id="vendor_gstin"
                      type="text"
                      className="input mono"
                      placeholder="e.g. 27AAAAA0000A1Z5"
                      value={formData.gstin}
                      onChange={(e) => handleFieldChange('gstin', e.target.value.toUpperCase())}
                      maxLength={15}
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="vendor_state" className="lbl">State</label>
                    <select
                      id="vendor_state"
                      className="select"
                      value={formData.state}
                      onChange={(e) => handleFieldChange('state', e.target.value)}
                    >
                      <option value="">Select state...</option>
                      {INDIAN_STATES.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="field">
                  <label htmlFor="vendor_billing_address" className="lbl">Billing Address</label>
                  <textarea
                    id="vendor_billing_address"
                    className="input"
                    rows={2}
                    placeholder="Registered business address..."
                    value={formData.billing_address}
                    onChange={(e) => handleFieldChange('billing_address', e.target.value)}
                    style={{ resize: 'vertical' }}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div className="field">
                    <label htmlFor="vendor_pin_code" className="lbl">PIN Code</label>
                    <input
                      id="vendor_pin_code"
                      type="text"
                      className="input mono"
                      placeholder="e.g. 400001"
                      value={formData.pin_code}
                      onChange={(e) => handleFieldChange('pin_code', e.target.value)}
                      maxLength={6}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* ============================================================== */}
            {/* TAB 2: PEOPLE / CONTACTS                                       */}
            {/* ============================================================== */}
            {activeTab === 'people' && (
              <div className="stack" style={{ gap: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: '13px', color: 'var(--muted)' }}>
                    Add personnel and specify communication preferences.
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={handleAddPerson}
                    disabled={isSubmitting}
                  >
                    + Add Person
                  </button>
                </div>

                <div className="stack" style={{ gap: '14px' }}>
                  {formData.people.map((person, idx) => (
                    <div
                      key={idx}
                      className="card"
                      style={{
                        padding: '14px',
                        background: 'var(--surface-2)',
                        border: '1px solid var(--line-2)',
                        borderRadius: 'var(--r-md)'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                        <strong style={{ fontSize: '13px', color: 'var(--ink)' }}>
                          Person #{idx + 1}
                        </strong>
                        {formData.people.length > 1 && (
                          <button
                            type="button"
                            className="icon-btn xs"
                            onClick={() => handleRemovePerson(idx)}
                            aria-label={`Remove person ${idx + 1}`}
                            title="Remove person"
                          >
                            ✕
                          </button>
                        )}
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                        <div className="field">
                          <label className="lbl">Full Name</label>
                          <input
                            type="text"
                            className="input"
                            placeholder="e.g. Rahul Sharma"
                            value={person.name}
                            onChange={(e) => handlePersonChange(idx, 'name', e.target.value)}
                          />
                        </div>

                        <div className="field">
                          <label className="lbl">Designation</label>
                          <input
                            type="text"
                            className="input"
                            placeholder="e.g. Accounts / Billing"
                            value={person.designation}
                            onChange={(e) => handlePersonChange(idx, 'designation', e.target.value)}
                          />
                        </div>

                        <div className="field">
                          <label className="lbl">Email</label>
                          <input
                            type="email"
                            className="input"
                            placeholder="rahul@vendor.example"
                            value={person.email}
                            onChange={(e) => handlePersonChange(idx, 'email', e.target.value)}
                          />
                        </div>

                        <div className="field">
                          <label className="lbl">Phone</label>
                          <input
                            type="tel"
                            className="input"
                            placeholder="e.g. +91 9876543210"
                            value={person.phone}
                            onChange={(e) => handlePersonChange(idx, 'phone', e.target.value)}
                          />
                        </div>
                      </div>

                      {/* Communication Checkboxes */}
                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: '16px',
                          marginTop: '12px',
                          paddingTop: '10px',
                          borderTop: '1px dashed var(--line-2)',
                          fontSize: '12px'
                        }}
                      >
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={person.receives_accounts}
                            onChange={(e) => handlePersonChange(idx, 'receives_accounts', e.target.checked)}
                          />
                          Receives accounts / bills
                        </label>

                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={person.receives_projects}
                            onChange={(e) => handlePersonChange(idx, 'receives_projects', e.target.checked)}
                          />
                          Receives projects
                        </label>

                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={person.receives_management}
                            onChange={(e) => handlePersonChange(idx, 'receives_management', e.target.checked)}
                          />
                          Receives management
                        </label>

                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={person.on_whatsapp}
                            onChange={(e) => handlePersonChange(idx, 'on_whatsapp', e.target.checked)}
                          />
                          On WhatsApp
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ============================================================== */}
            {/* TAB 3: TAX, TERMS & BANK                                       */}
            {/* ============================================================== */}
            {activeTab === 'tax_bank' && (
              <div className="stack" style={{ gap: '18px' }}>
                {/* Tax Sub-section */}
                <div>
                  <div
                    style={{
                      fontSize: '11.5px',
                      fontWeight: 600,
                      color: 'var(--muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '.06em',
                      marginBottom: '10px'
                    }}
                  >
                    Tax Details
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div className="field">
                      <label htmlFor="vendor_pan" className="lbl">PAN</label>
                      <input
                        id="vendor_pan"
                        type="text"
                        className="input mono"
                        placeholder="e.g. ABCDE1234F"
                        value={formData.pan}
                        onChange={(e) => handleFieldChange('pan', e.target.value.toUpperCase())}
                        maxLength={10}
                      />
                    </div>

                    <div className="field">
                      <label htmlFor="vendor_default_gst_type" className="lbl">Default GST Type</label>
                      <select
                        id="vendor_default_gst_type"
                        className="select"
                        value={formData.default_gst_type}
                        onChange={(e) => handleFieldChange('default_gst_type', e.target.value)}
                      >
                        <option value="CGST + SGST">CGST + SGST (Intra-state)</option>
                        <option value="IGST">IGST (Inter-state)</option>
                        <option value="none">Nil / Exempt / None</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Terms Sub-section */}
                <div>
                  <div
                    style={{
                      fontSize: '11.5px',
                      fontWeight: 600,
                      color: 'var(--muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '.06em',
                      marginBottom: '10px'
                    }}
                  >
                    Payment Terms &amp; Notes
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '12px' }}>
                    <div className="field">
                      <label htmlFor="vendor_credit_period" className="lbl">Credit Period (Days)</label>
                      <input
                        id="vendor_credit_period"
                        type="number"
                        min="0"
                        className="input num"
                        placeholder="30"
                        value={formData.credit_period}
                        onChange={(e) => handleFieldChange('credit_period', e.target.value)}
                      />
                    </div>

                    <div className="field">
                      <label htmlFor="vendor_notes" className="lbl">Notes</label>
                      <input
                        id="vendor_notes"
                        type="text"
                        className="input"
                        placeholder="e.g. Standard terms, payment upon inspection"
                        value={formData.notes}
                        onChange={(e) => handleFieldChange('notes', e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                {/* Bank Sub-section */}
                <div>
                  <div
                    style={{
                      fontSize: '11.5px',
                      fontWeight: 600,
                      color: 'var(--muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '.06em',
                      marginBottom: '10px'
                    }}
                  >
                    Bank Details
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div className="field">
                      <label htmlFor="vendor_bank_name" className="lbl">Bank Name</label>
                      <input
                        id="vendor_bank_name"
                        type="text"
                        className="input"
                        placeholder="e.g. HDFC Bank Ltd"
                        value={formData.bank_name}
                        onChange={(e) => handleFieldChange('bank_name', e.target.value)}
                      />
                    </div>

                    <div className="field">
                      <label htmlFor="vendor_account_holder_name" className="lbl">Account Holder Name</label>
                      <input
                        id="vendor_account_holder_name"
                        type="text"
                        className="input"
                        placeholder="Account name as per bank"
                        value={formData.account_holder_name}
                        onChange={(e) => handleFieldChange('account_holder_name', e.target.value)}
                      />
                    </div>

                    <div className="field">
                      <label htmlFor="vendor_account_number" className="lbl">Account Number</label>
                      <input
                        id="vendor_account_number"
                        type="text"
                        className="input mono"
                        placeholder="e.g. 50200012345678"
                        value={formData.account_number}
                        onChange={(e) => handleFieldChange('account_number', e.target.value)}
                      />
                    </div>

                    <div className="field">
                      <label htmlFor="vendor_ifsc_code" className="lbl">IFSC Code</label>
                      <input
                        id="vendor_ifsc_code"
                        type="text"
                        className="input mono"
                        placeholder="e.g. HDFC0000123"
                        value={formData.ifsc_code}
                        onChange={(e) => handleFieldChange('ifsc_code', e.target.value.toUpperCase())}
                        maxLength={11}
                      />
                    </div>

                    <div className="field" style={{ gridColumn: 'span 2' }}>
                      <label htmlFor="vendor_upi_id" className="lbl">UPI ID</label>
                      <input
                        id="vendor_upi_id"
                        type="text"
                        className="input"
                        placeholder="e.g. company@upi"
                        value={formData.upi_id}
                        onChange={(e) => handleFieldChange('upi_id', e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Modal Footer */}
          <div className="modal-f" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              {activeTab !== 'company' && (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setActiveTab(activeTab === 'tax_bank' ? 'people' : 'company')}
                  disabled={isSubmitting}
                >
                  ← Back
                </button>
              )}
              {activeTab !== 'tax_bank' && (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setActiveTab(activeTab === 'company' ? 'people' : 'tax_bank')}
                  disabled={isSubmitting}
                >
                  Next →
                </button>
              )}
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
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
                style={{ minWidth: '120px' }}
              >
                {isSubmitting ? 'Adding vendor...' : 'Add vendor'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddVendorModal;
