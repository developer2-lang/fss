import React, { useState, useCallback } from 'react';
import { SupabaseService } from '../lib/supabase';

export interface AddProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (newProject: any) => void;
  clients?: Array<{ id: string; name: string; kind?: string }>;
  departments?: Array<{ id: string; name: string }>;
}

const DEFAULT_DEPT_NAMES = [
  'Design',
  'Engineering',
  'Sales & BD',
  'Operations / Admin',
  'Finance',
  'Management'
];

const STATUS_OPTIONS = [
  'Active',
  'On Hold',
  'Completed',
  'Inactive'
];

export const AddProjectModal: React.FC<AddProjectModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  clients = [],
  departments = []
}) => {
  const clientList = clients.filter(c => !c.kind || c.kind === 'client');
  const deptList = (departments && departments.length > 0)
    ? departments.map(d => d.name)
    : DEFAULT_DEPT_NAMES;

  const [formData, setFormData] = useState({
    project_code: '',
    project_name: '',
    client_id: clientList[0]?.id || '',
    department: deptList[0] || 'Design',
    contract_value: '',
    start_date: new Date().toISOString().slice(0, 10),
    status: 'Active'
  });

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setFormData({
      project_code: '',
      project_name: '',
      client_id: clientList[0]?.id || '',
      department: deptList[0] || 'Design',
      contract_value: '',
      start_date: new Date().toISOString().slice(0, 10),
      status: 'Active'
    });
    setErrorMessage(null);
    setIsSubmitting(false);
  }, [clientList, deptList]);

  if (!isOpen) return null;

  const handleModalClose = () => {
    if (isSubmitting) return;
    resetForm();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const code = formData.project_code.trim();
    if (!code) {
      setErrorMessage('Project code is required.');
      return;
    }

    const name = formData.project_name.trim();
    if (!name) {
      setErrorMessage('Project name is required.');
      return;
    }

    const dept = formData.department.trim();
    if (!dept) {
      setErrorMessage('Please select a department.');
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await SupabaseService.saveProject(
        {
          project_code: code,
          project_name: name,
          client_id: formData.client_id || (clientList[0]?.id || 1),
          department: dept,
          contract_value: Number(formData.contract_value) || 0,
          start_date: formData.start_date || null,
          status: formData.status
        },
        clientList
      );

      if (res) {
        if (onSuccess) onSuccess(res);
        resetForm();
        onClose();
      }
    } catch (err: any) {
      console.error('Error saving project to Supabase:', err);
      setErrorMessage(err.message || 'Failed to save project to Supabase.');
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
      aria-labelledby="add-project-title"
      style={{ zIndex: 1000 }}
    >
      <div
        className="modal"
        style={{ maxWidth: '600px', width: '92%' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="modal-h" style={{ justifyContent: 'space-between' }}>
          <div>
            <h2 id="add-project-title" style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>
              Add project
            </h2>
            <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>
              Create a new client project and sync to Supabase (<code>fss_projects</code>)
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
        <form onSubmit={handleSubmit} id="addProjectForm">
          <div className="modal-b stack" style={{ gap: '14px', maxHeight: '70vh' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '12px' }}>
              <div className="field">
                <label htmlFor="prj_code" className="lbl">
                  Project Code <span style={{ color: 'var(--out)' }}>*</span>
                </label>
                <input
                  id="prj_code"
                  type="text"
                  required
                  className="input mono"
                  placeholder="e.g. IU-2610"
                  value={formData.project_code}
                  onChange={(e) => setFormData(prev => ({ ...prev, project_code: e.target.value.toUpperCase() }))}
                  autoFocus
                />
              </div>

              <div className="field">
                <label htmlFor="prj_name" className="lbl">
                  Project Name <span style={{ color: 'var(--out)' }}>*</span>
                </label>
                <input
                  id="prj_name"
                  type="text"
                  required
                  className="input"
                  placeholder="e.g. Smart Switch Range Gen 2"
                  value={formData.project_name}
                  onChange={(e) => setFormData(prev => ({ ...prev, project_name: e.target.value }))}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="field">
                <label htmlFor="prj_client" className="lbl">
                  Client <span style={{ color: 'var(--out)' }}>*</span>
                </label>
                <select
                  id="prj_client"
                  className="select"
                  value={formData.client_id}
                  onChange={(e) => setFormData(prev => ({ ...prev, client_id: e.target.value }))}
                >
                  {clientList.length > 0 ? (
                    clientList.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))
                  ) : (
                    <option value="1">Default Client</option>
                  )}
                </select>
              </div>

              <div className="field">
                <label htmlFor="prj_dept" className="lbl">
                  Department <span style={{ color: 'var(--out)' }}>*</span>
                </label>
                <select
                  id="prj_dept"
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
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="field">
                <label htmlFor="prj_val" className="lbl">Contract Value (₹, pre-GST)</label>
                <input
                  id="prj_val"
                  type="number"
                  min="0"
                  step="1000"
                  className="input"
                  placeholder="e.g. 2500000"
                  value={formData.contract_value}
                  onChange={(e) => setFormData(prev => ({ ...prev, contract_value: e.target.value }))}
                />
                <div className="hint" style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>
                  Used when project has no orders; sum of orders used otherwise.
                </div>
              </div>

              <div className="field">
                <label htmlFor="prj_start" className="lbl">Start Date</label>
                <input
                  id="prj_start"
                  type="date"
                  className="input"
                  value={formData.start_date}
                  onChange={(e) => setFormData(prev => ({ ...prev, start_date: e.target.value }))}
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor="prj_status" className="lbl">Status</label>
              <select
                id="prj_status"
                className="select"
                value={formData.status}
                onChange={(e) => setFormData(prev => ({ ...prev, status: e.target.value }))}
              >
                {STATUS_OPTIONS.map(s => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
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
              {isSubmitting ? 'Saving to Supabase...' : 'Save Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddProjectModal;
