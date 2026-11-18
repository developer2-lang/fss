import React from 'react';
import { useAddClientForm, TabType, PersonContact } from '../hooks/useAddClientForm';

export interface AddClientModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (newClient: any) => void;
}

const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
  'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram',
  'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
  'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Delhi', 'Chandigarh', 'Puducherry'
];

export const AddClientModal: React.FC<AddClientModalProps> = ({
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
    hasAccountsEmail,
    handleFieldChange,
    handleAddPerson,
    handleRemovePerson,
    handlePersonChange,
    handleSubmit,
    resetForm
  } = useAddClientForm({
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
      aria-labelledby="add-client-title"
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
            <h2 id="add-client-title" style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>
              Add client
            </h2>
            <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>
              Create a new client profile, contact personnel, and tax/banking terms
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
              {!hasAccountsEmail && (
                <span
                  title="Payment email required"
                  style={{
                    display: 'inline-block',
                    width: '7px',
                    height: '7px',
                    borderRadius: '50%',
                    backgroundColor: 'var(--out)'
                  }}
                />
              )}
            </button>
            <button
              type="button"
              className={activeTab === 'tax_bank' ? 'on' : ''}
              onClick={() => setActiveTab('tax_bank')}
            >
              Tax, terms & bank
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
        <form onSubmit={handleSubmit} id="addClientForm">
          <div className="modal-b" style={{ minHeight: '380px', maxHeight: '65vh' }}>
            {/* ============================================================== */}
            {/* TAB 1: COMPANY                                                 */}
            {/* ============================================================== */}
            {activeTab === 'company' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div className="field">
                  <label htmlFor="client_name" className="lbl">
                    Client Name <span style={{ color: 'var(--out)' }}>*</span>
                  </label>
                  <input
                    id="client_name"
                    type="text"
                    className="input"
                    placeholder="e.g. Acme Technologies Pvt Ltd"
                    value={formData.client_name}
                    onChange={(e) => handleFieldChange('client_name', e.target.value)}
                    required
                    autoFocus
                  />
                  <span className="hint">The official trade or legal entity name</span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                  <div className="field">
                    <label htmlFor="gstin" className="lbl">
                      GSTIN
                    </label>
                    <input
                      id="gstin"
                      type="text"
                      className="input mono"
                      placeholder="e.g. 27AAAAA0000A1Z5"
                      value={formData.gstin}
                      onChange={(e) => handleFieldChange('gstin', e.target.value.toUpperCase())}
                      maxLength={15}
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="state" className="lbl">
                      State
                    </label>
                    <select
                      id="state"
                      className="select"
                      value={formData.state}
                      onChange={(e) => handleFieldChange('state', e.target.value)}
                    >
                      <option value="">Select State...</option>
                      {INDIAN_STATES.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="field">
                  <label htmlFor="billing_address" className="lbl">
                    Billing Address
                  </label>
                  <textarea
                    id="billing_address"
                    className="textarea"
                    placeholder="Registered address or official billing site..."
                    rows={3}
                    value={formData.billing_address}
                    onChange={(e) => handleFieldChange('billing_address', e.target.value)}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                  <div className="field">
                    <label htmlFor="pin_code" className="lbl">
                      PIN Code
                    </label>
                    <input
                      id="pin_code"
                      type="text"
                      className="input mono"
                      placeholder="e.g. 400001"
                      value={formData.pin_code}
                      onChange={(e) => handleFieldChange('pin_code', e.target.value)}
                      maxLength={10}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* ============================================================== */}
            {/* TAB 2: PEOPLE                                                  */}
            {/* ============================================================== */}
            {activeTab === 'people' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* Warning Alert Banner (Crucial Requirement) */}
                {!hasAccountsEmail && (
                  <div
                    className="notice"
                    style={{
                      background: 'var(--gold-soft)',
                      border: '1px solid var(--gold-line)',
                      color: 'var(--ink)'
                    }}
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="var(--warn)"
                      strokeWidth="2"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <div>
                      <strong>No email yet — add one so payment emails can go out</strong>
                      <div style={{ fontSize: '12px', color: 'var(--ink-2)', marginTop: '2px' }}>
                        Provide an email address and ensure <em>Receives accounts</em> is checked for at least one person.
                      </div>
                    </div>
                  </div>
                )}

                {/* List of Contact Cards */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {formData.people.map((person, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: '14px 16px',
                        borderRadius: 'var(--r-sm)',
                        border: '1px solid var(--line)',
                        background: 'var(--surface-2)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '12px'
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          paddingBottom: '8px',
                          borderBottom: '1px solid var(--line-2)'
                        }}
                      >
                        <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ink-2)' }}>
                          Contact Person #{idx + 1}
                        </span>
                        {formData.people.length > 1 && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm btn-danger"
                            onClick={() => handleRemovePerson(idx)}
                            title="Remove contact"
                          >
                            Remove
                          </button>
                        )}
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div className="field">
                          <label className="lbl">Full Name</label>
                          <input
                            type="text"
                            className="input"
                            placeholder="e.g. Rajesh Sharma"
                            value={person.name}
                            onChange={(e) => handlePersonChange(idx, 'name', e.target.value)}
                          />
                        </div>

                        <div className="field">
                          <label className="lbl">Designation</label>
                          <input
                            type="text"
                            className="input"
                            placeholder="e.g. Accounts Manager"
                            value={person.designation}
                            onChange={(e) => handlePersonChange(idx, 'designation', e.target.value)}
                          />
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div className="field">
                          <label className="lbl">Email Address</label>
                          <input
                            type="email"
                            className="input"
                            placeholder="e.g. rajesh@acme.com"
                            value={person.email}
                            onChange={(e) => handlePersonChange(idx, 'email', e.target.value)}
                          />
                        </div>

                        <div className="field">
                          <label className="lbl">Phone Number</label>
                          <input
                            type="tel"
                            className="input"
                            placeholder="e.g. +91 98765 43210"
                            value={person.phone}
                            onChange={(e) => handlePersonChange(idx, 'phone', e.target.value)}
                          />
                        </div>
                      </div>

                      {/* Notification Preferences & Roles */}
                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: '16px',
                          paddingTop: '6px',
                          alignItems: 'center'
                        }}
                      >
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={person.receives_accounts}
                            onChange={(e) =>
                              handlePersonChange(idx, 'receives_accounts', e.target.checked)
                            }
                          />
                          <span>Receives accounts (Invoices/Ledgers)</span>
                        </label>

                        <label className="check">
                          <input
                            type="checkbox"
                            checked={person.receives_projects}
                            onChange={(e) =>
                              handlePersonChange(idx, 'receives_projects', e.target.checked)
                            }
                          />
                          <span>Receives projects</span>
                        </label>

                        <label className="check">
                          <input
                            type="checkbox"
                            checked={person.receives_management}
                            onChange={(e) =>
                              handlePersonChange(idx, 'receives_management', e.target.checked)
                            }
                          />
                          <span>Receives management</span>
                        </label>

                        <label className="check">
                          <input
                            type="checkbox"
                            checked={person.on_whatsapp}
                            onChange={(e) =>
                              handlePersonChange(idx, 'on_whatsapp', e.target.checked)
                            }
                          />
                          <span>On WhatsApp</span>
                        </label>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Add Person Action */}
                <div>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={handleAddPerson}
                    style={{ gap: '6px' }}
                  >
                    <span style={{ fontSize: '15px', lineHeight: 1 }}>+</span> Add person
                  </button>
                </div>
              </div>
            )}

            {/* ============================================================== */}
            {/* TAB 3: TAX, TERMS & BANK                                       */}
            {/* ============================================================== */}
            {activeTab === 'tax_bank' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
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
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                    <div className="field">
                      <label htmlFor="pan" className="lbl">PAN</label>
                      <input
                        id="pan"
                        type="text"
                        className="input mono"
                        placeholder="e.g. ABCDE1234F"
                        value={formData.pan}
                        onChange={(e) => handleFieldChange('pan', e.target.value.toUpperCase())}
                        maxLength={10}
                      />
                    </div>

                    <div className="field">
                      <label htmlFor="tan" className="lbl">TAN</label>
                      <input
                        id="tan"
                        type="text"
                        className="input mono"
                        placeholder="e.g. MUMB12345C"
                        value={formData.tan}
                        onChange={(e) => handleFieldChange('tan', e.target.value.toUpperCase())}
                        maxLength={10}
                      />
                    </div>

                    <div className="field">
                      <label htmlFor="default_gst_type" className="lbl">Default GST Type</label>
                      <select
                        id="default_gst_type"
                        className="select"
                        value={formData.default_gst_type}
                        onChange={(e) => handleFieldChange('default_gst_type', e.target.value)}
                      >
                        <option value="CGST + SGST">CGST + SGST (Intra-State)</option>
                        <option value="IGST">IGST (Inter-State)</option>
                        <option value="Exempt">Exempt</option>
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
                    Payment Terms & Notes
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '12px' }}>
                    <div className="field">
                      <label htmlFor="credit_period" className="lbl">Credit Period (Days)</label>
                      <input
                        id="credit_period"
                        type="number"
                        min="0"
                        className="input num"
                        placeholder="30"
                        value={formData.credit_period}
                        onChange={(e) => handleFieldChange('credit_period', e.target.value)}
                      />
                    </div>

                    <div className="field">
                      <label htmlFor="notes" className="lbl">Notes</label>
                      <input
                        id="notes"
                        type="text"
                        className="input"
                        placeholder="e.g. 50% advance, balance on delivery"
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
                      <label htmlFor="bank_name" className="lbl">Bank Name</label>
                      <input
                        id="bank_name"
                        type="text"
                        className="input"
                        placeholder="e.g. HDFC Bank Ltd"
                        value={formData.bank_name}
                        onChange={(e) => handleFieldChange('bank_name', e.target.value)}
                      />
                    </div>

                    <div className="field">
                      <label htmlFor="bank_account_name" className="lbl">Account Name</label>
                      <input
                        id="bank_account_name"
                        type="text"
                        className="input"
                        placeholder="Account holder's name"
                        value={formData.bank_account_name}
                        onChange={(e) => handleFieldChange('bank_account_name', e.target.value)}
                      />
                    </div>

                    <div className="field">
                      <label htmlFor="bank_account_number" className="lbl">Account Number</label>
                      <input
                        id="bank_account_number"
                        type="text"
                        className="input mono"
                        placeholder="e.g. 50200012345678"
                        value={formData.bank_account_number}
                        onChange={(e) => handleFieldChange('bank_account_number', e.target.value)}
                      />
                    </div>

                    <div className="field">
                      <label htmlFor="bank_ifsc" className="lbl">IFSC Code</label>
                      <input
                        id="bank_ifsc"
                        type="text"
                        className="input mono"
                        placeholder="e.g. HDFC0000123"
                        value={formData.bank_ifsc}
                        onChange={(e) => handleFieldChange('bank_ifsc', e.target.value.toUpperCase())}
                        maxLength={11}
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
                {isSubmitting ? 'Adding client...' : 'Add client'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddClientModal;
