import React, { useState, useCallback } from 'react';
import { SupabaseService } from '../lib/supabase';

export interface AddEmployeeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (newEmployee: any) => void;
  departments?: Array<{ id: string; name: string }>;
}

const DEFAULT_DEPT_NAMES = [
  'Design',
  'Engineering',
  'Sales & BD',
  'Operations / Admin',
  'HR',
  'Finance',
  'Management'
];

export const AddEmployeeModal: React.FC<AddEmployeeModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  departments
}) => {
  const deptList = (departments && departments.length > 0)
    ? departments.map(d => d.name)
    : DEFAULT_DEPT_NAMES;

  const [formData, setFormData] = useState({
    name: '',
    department: deptList[0] || 'Operations / Admin',
    designation: '',
    monthly_salary: '',
    joined: new Date().toISOString().slice(0, 10),
    emails: '',
    phone: '',
    is_active: true
  });

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setFormData({
      name: '',
      department: deptList[0] || 'Operations / Admin',
      designation: '',
      monthly_salary: '',
      joined: new Date().toISOString().slice(0, 10),
      emails: '',
      phone: '',
      is_active: true
    });
    setErrorMessage(null);
    setIsSubmitting(false);
  }, [deptList]);

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
      setErrorMessage('Employee name is required.');
      return;
    }

    const dept = formData.department.trim();
    if (!dept) {
      setErrorMessage('Please select a department.');
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await SupabaseService.saveEmployee({
        name,
        department: dept,
        designation: formData.designation.trim(),
        monthly_salary: Number(formData.monthly_salary) || 0,
        joined: formData.joined || null,
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
      console.error('Error saving employee to Supabase:', err);
      setErrorMessage(err.message || 'Failed to save employee to Supabase.');
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
      aria-labelledby="add-employee-title"
      style={{ zIndex: 1000 }}
    >
      <div
        className="modal"
        style={{ maxWidth: '580px', width: '92%' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="modal-h" style={{ justifyContent: 'space-between' }}>
          <div>
            <h2 id="add-employee-title" style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>
              Add employee
            </h2>
            <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>
              Create an employee profile and sync to Supabase (<code>fss_employe</code>)
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
        <form onSubmit={handleSubmit} id="addEmployeeForm">
          <div className="modal-b stack" style={{ gap: '14px', maxHeight: '70vh' }}>
            <div className="field">
              <label htmlFor="emp_name" className="lbl">
                Full Name <span style={{ color: 'var(--out)' }}>*</span>
              </label>
              <input
                id="emp_name"
                type="text"
                required
                className="input"
                placeholder="e.g. Aditya Bhosale"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                autoFocus
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="field">
                <label htmlFor="emp_dept" className="lbl">
                  Department <span style={{ color: 'var(--out)' }}>*</span>
                </label>
                <select
                  id="emp_dept"
                  className="select"
                  value={formData.department}
                  onChange={(e) => setFormData(prev => ({ ...prev, department: e.target.value }))}
                >
                  {deptList.map(d => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="emp_desig" className="lbl">Designation</label>
                <input
                  id="emp_desig"
                  type="text"
                  className="input"
                  placeholder="e.g. BD Manager"
                  value={formData.designation}
                  onChange={(e) => setFormData(prev => ({ ...prev, designation: e.target.value }))}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="field">
                <label htmlFor="emp_sal" className="lbl">Monthly Salary (₹)</label>
                <input
                  id="emp_sal"
                  type="number"
                  min="0"
                  step="500"
                  className="input num"
                  placeholder="e.g. 90000"
                  value={formData.monthly_salary}
                  onChange={(e) => setFormData(prev => ({ ...prev, monthly_salary: e.target.value }))}
                />
              </div>

              <div className="field">
                <label htmlFor="emp_joined" className="lbl">Joined Date</label>
                <input
                  id="emp_joined"
                  type="date"
                  className="input"
                  value={formData.joined}
                  onChange={(e) => setFormData(prev => ({ ...prev, joined: e.target.value }))}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="field">
                <label htmlFor="emp_emails" className="lbl">Emails</label>
                <input
                  id="emp_emails"
                  type="email"
                  className="input"
                  placeholder="name@iuova.example"
                  value={formData.emails}
                  onChange={(e) => setFormData(prev => ({ ...prev, emails: e.target.value }))}
                />
              </div>

              <div className="field">
                <label htmlFor="emp_phone" className="lbl">Phone</label>
                <input
                  id="emp_phone"
                  type="tel"
                  className="input"
                  placeholder="e.g. +91 98765 43210"
                  value={formData.phone}
                  onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                />
              </div>
            </div>

            <div className="field">
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
                <input
                  type="checkbox"
                  checked={formData.is_active}
                  onChange={(e) => setFormData(prev => ({ ...prev, is_active: e.target.checked }))}
                />
                <span>Active Employee</span>
              </label>
            </div>
          </div>

          {/* Modal Footer */}
          <div className="modal-f" style={{ justifyContent: 'flex-end', gap: '10px' }}>
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
              {isSubmitting ? 'Adding employee...' : 'Add employee'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddEmployeeModal;
