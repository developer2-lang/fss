import React, { useState, useCallback } from 'react';
import { SupabaseService } from '../lib/supabase';

export interface AddDepartmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (newDept: any) => void;
}

export const AddDepartmentModal: React.FC<AddDepartmentModalProps> = ({
  isOpen,
  onClose,
  onSuccess
}) => {
  const [formData, setFormData] = useState({
    department_name: '',
    manager: '',
    manager_email: ''
  });

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setFormData({
      department_name: '',
      manager: '',
      manager_email: ''
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

    const name = formData.department_name.trim();
    if (!name) {
      setErrorMessage('Department name is required.');
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await SupabaseService.saveDepartment({
        department_name: name,
        manager: formData.manager.trim() || null,
        manager_email: formData.manager_email.trim() || null
      });

      if (res) {
        if (onSuccess) onSuccess(res);
        resetForm();
        onClose();
      }
    } catch (err: any) {
      console.error('Error saving department to Supabase:', err);
      setErrorMessage(err.message || 'Failed to save department to Supabase.');
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
      aria-labelledby="add-dept-title"
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
            <h2 id="add-dept-title" style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>
              Add department
            </h2>
            <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>
              Create a new department and sync to Supabase (<code>fss_departments</code>)
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
        <form onSubmit={handleSubmit} id="addDepartmentForm">
          <div className="modal-b stack" style={{ gap: '14px', maxHeight: '70vh' }}>
            <div className="field">
              <label htmlFor="dept_name" className="lbl">
                Department Name <span style={{ color: 'var(--out)' }}>*</span>
              </label>
              <input
                id="dept_name"
                type="text"
                required
                className="input"
                placeholder="e.g. Quality Assurance"
                value={formData.department_name}
                onChange={(e) => setFormData(prev => ({ ...prev, department_name: e.target.value }))}
                autoFocus
              />
            </div>

            <div className="field">
              <label htmlFor="dept_manager" className="lbl">Manager</label>
              <input
                id="dept_manager"
                type="text"
                className="input"
                placeholder="e.g. Rajesh Sharma"
                value={formData.manager}
                onChange={(e) => setFormData(prev => ({ ...prev, manager: e.target.value }))}
              />
              <div className="hint" style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>
                Department manager for scorecard access &amp; approvals.
              </div>
            </div>

            <div className="field">
              <label htmlFor="dept_email" className="lbl">Manager Email</label>
              <input
                id="dept_email"
                type="email"
                className="input"
                placeholder="e.g. rajesh@company.com"
                value={formData.manager_email}
                onChange={(e) => setFormData(prev => ({ ...prev, manager_email: e.target.value }))}
              />
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
              {isSubmitting ? 'Saving to Supabase...' : 'Save Department'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddDepartmentModal;
