import React, { useState, useEffect, useCallback } from 'react';
import { SupabaseService } from '../lib/supabase';

export interface AddCategoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (newCategory: any) => void;
  initialLookups?: {
    types: any[];
    summaryBuckets: any[];
    groups: any[];
    linkedTo: any[];
    natures: any[];
    tdsSections: any[];
    inputGstOnBills?: any[];
  };
}

const DEFAULT_LOOKUPS = {
  types: [
    { id: 1, name: 'Select' },
    { id: 2, name: 'Outflow' },
    { id: 3, name: 'Inflow' }
  ],
  summaryBuckets: [
    { id: 1, name: 'Operating costs (outflow)', associated_type: 'Outflow' },
    { id: 2, name: 'Project costs (outflow)', associated_type: 'Outflow' },
    { id: 3, name: 'Tax & statutory (outflow)', associated_type: 'Outflow' },
    { id: 4, name: 'Capex (outflow)', associated_type: 'Outflow' },
    { id: 5, name: 'Financing & owner (outflow)', associated_type: 'Outflow' },
    { id: 6, name: 'Operating receipts (inflow)', associated_type: 'Inflow' },
    { id: 7, name: 'Other income (inflow)', associated_type: 'Inflow' },
    { id: 8, name: 'Financing (inflow)', associated_type: 'Inflow' }
  ],
  groups: [
    { id: 1, name: 'People' },
    { id: 2, name: 'Office – Fixed' },
    { id: 3, name: 'Office – Variable' },
    { id: 4, name: 'Travel' },
    { id: 5, name: 'Project Costs' },
    { id: 6, name: 'Professional & Admin' },
    { id: 7, name: 'Capex / Purchases' },
    { id: 8, name: 'Statutory & Tax' },
    { id: 9, name: 'Financing & Owner' },
    { id: 10, name: 'Operating Receipts' },
    { id: 11, name: 'Other Income' },
    { id: 12, name: 'Financing' }
  ],
  linkedTo: [
    { id: 1, name: 'Client' },
    { id: 2, name: 'Vendor' },
    { id: 3, name: 'Employee' },
    { id: 4, name: 'Other' }
  ],
  natures: [
    { id: 1, name: 'Operating' },
    { id: 2, name: 'Statutory / Tax' },
    { id: 3, name: 'Capex' },
    { id: 4, name: 'Financing / Owner' }
  ],
  tdsSections: [
    { id: 1, code: '192', description: 'Salary' },
    { id: 2, code: '194C', description: 'Contractors' },
    { id: 3, code: '194J', description: 'Professional / technical fees' },
    { id: 4, code: '194I', description: 'Rent' },
    { id: 5, code: '194H', description: 'Commission / brokerage' },
    { id: 6, code: '194A', description: 'Interest (other than bank)' }
  ],
  inputGstOnBills: [
    {
      id: 1,
      value: 'claimable_itc',
      label: 'Claimable (ITC)',
      description: 'Input GST eligible for input tax credit, subject to applicable rules.',
      is_active: true
    },
    {
      id: 2,
      value: 'blocked_not_claimable',
      label: 'Blocked · not claimable',
      description: 'Input GST that is blocked or not eligible for input tax credit.',
      is_active: true
    }
  ]
};

export const AddCategoryModal: React.FC<AddCategoryModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  initialLookups
}) => {
  const [lookups, setLookups] = useState<{
    types: any[];
    summaryBuckets: any[];
    groups: any[];
    linkedTo: any[];
    natures: any[];
    tdsSections: any[];
    inputGstOnBills?: any[];
  }>(initialLookups || DEFAULT_LOOKUPS);

  const [formData, setFormData] = useState({
    name: '',
    type: 'outflow',
    bucket: '',
    group: 'Office – Fixed',
    partyKind: 'vendor',
    kind: 'operating',
    sac: '',
    itcBlocked: false,
    tdsSection: ''
  });

  const [isCustomGroup, setIsCustomGroup] = useState<boolean>(false);
  const [customGroupName, setCustomGroupName] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Load live lookups from Supabase whenever modal opens
  useEffect(() => {
    if (isOpen) {
      SupabaseService.loadCategoryLookups().then(data => {
        if (data) setLookups(data);
      }).catch(err => {
        console.warn('Could not refresh category lookups:', err);
      });
    }
  }, [isOpen]);

  const resetForm = useCallback(() => {
    setFormData({
      name: '',
      type: 'outflow',
      bucket: '',
      group: 'Office – Fixed',
      partyKind: 'vendor',
      kind: 'operating',
      sac: '',
      itcBlocked: false,
      tdsSection: ''
    });
    setIsCustomGroup(false);
    setCustomGroupName('');
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
      setErrorMessage('Category name is required.');
      return;
    }

    if (!formData.type || formData.type === 'select') {
      setErrorMessage('Please select a valid Category Type.');
      return;
    }

    const group = (isCustomGroup ? customGroupName : formData.group).trim();
    if (!group) {
      setErrorMessage('Group is required.');
      return;
    }

    setIsSubmitting(true);

    try {
      const selectedTypeObj = lookups.types.find((t: any) => {
        const tn = (t.name || '').trim().toLowerCase();
        return tn === formData.type || (formData.type && tn.includes(formData.type));
      });

      const res = await SupabaseService.saveCategory({
        category_name: name,
        type: formData.type,
        type_id: selectedTypeObj?.id ?? undefined,
        bucket: formData.bucket || null,
        group: group,
        partyKind: formData.partyKind,
        kind: formData.kind,
        sac: formData.sac.trim() || null,
        itcBlocked: formData.itcBlocked,
        tdsSection: formData.tdsSection || null
      });

      if (res) {
        if (onSuccess) onSuccess(res);
        resetForm();
        onClose();
      }
    } catch (err: any) {
      console.error('Error saving category to Supabase:', err);
      setErrorMessage(err.message || 'Failed to save category to Supabase.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filter summary buckets based on selected type
  const isOutflow = formData.type === 'outflow';
  const availableBuckets = lookups.summaryBuckets.filter(b => {
    if (!b.associated_type) return true;
    return isOutflow
      ? b.associated_type.toLowerCase() === 'outflow'
      : b.associated_type.toLowerCase() === 'inflow';
  });

  return (
    <div
      className="drawer-ov"
      onClick={handleModalClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-cat-title"
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
            <h2 id="add-cat-title" style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>
              Add category
            </h2>
            <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>
              Create a new category and sync to Supabase (<code>fss_categories</code>)
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
        <form onSubmit={handleSubmit} id="addCategoryForm">
          <div className="modal-b stack" style={{ gap: '14px', maxHeight: '72vh', overflowY: 'auto' }}>
            {/* Category Name */}
            <div className="field">
              <label htmlFor="cat_name" className="lbl">
                Category name <span style={{ color: 'var(--out)' }}>*</span>
              </label>
              <input
                id="cat_name"
                type="text"
                required
                className="input"
                placeholder="e.g. Graphic Design Services"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                autoFocus
              />
            </div>

            {/* Type & Summary Bucket */}
            <div className="row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="field">
                <label htmlFor="cat_type" className="lbl">
                  Type <span style={{ color: 'var(--out)' }}>*</span>
                </label>
                <select
                  id="cat_type"
                  className="select"
                  required
                  value={formData.type}
                  onChange={(e) => {
                    const newType = e.target.value;
                    const defaultGroup = newType === 'inflow' ? 'Operating Receipts' : 'Office – Fixed';
                    setIsCustomGroup(false);
                    setFormData(prev => ({
                      ...prev,
                      type: newType,
                      bucket: '', // reset bucket on type change
                      group: defaultGroup,
                      partyKind: newType === 'inflow' ? 'client' : 'vendor'
                    }));
                  }}
                >
                  {lookups.types && lookups.types.length > 0 ? (
                    lookups.types.map((t: any) => {
                      const isSelect = (t.name || '').trim().toLowerCase() === 'select';
                      const optVal = isSelect ? '' : (t.name || '').trim().toLowerCase();
                      return (
                        <option
                          key={t.id ?? t.name}
                          value={optVal}
                        >
                          {t.name}
                        </option>
                      );
                    })
                  ) : (
                    <>
                      <option value="outflow">Outflow</option>
                      <option value="inflow">Inflow</option>
                    </>
                  )}
                </select>
              </div>

              <div className="field">
                <label htmlFor="cat_bucket" className="lbl">Summary bucket</label>
                <select
                  id="cat_bucket"
                  className="select"
                  value={formData.bucket}
                  onChange={(e) => setFormData(prev => ({ ...prev, bucket: e.target.value }))}
                >
                  <option value="">— (Auto-derive from group &amp; nature)</option>
                  {availableBuckets.map(b => (
                    <option key={b.id || b.name} value={b.name}>
                      {b.name}
                    </option>
                  ))}
                </select>
                <div className="hint" style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '3px' }}>
                  Top level in summary views. Leave blank to derive from group &amp; nature.
                </div>
              </div>
            </div>

            {/* Group & Linked To */}
            <div className="row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="field">
                <label htmlFor="cat_group" className="lbl">
                  Group <span style={{ color: 'var(--out)' }}>*</span>
                </label>
                {!isCustomGroup ? (
                  <select
                    id="cat_group"
                    className="select"
                    required
                    value={formData.group}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '__custom__') {
                        setIsCustomGroup(true);
                        setCustomGroupName('');
                      } else {
                        setIsCustomGroup(false);
                        setFormData(prev => ({ ...prev, group: val }));
                      }
                    }}
                  >
                    <option value="" disabled>Select group</option>
                    {lookups.groups.map(g => (
                      <option key={g.id || g.name} value={g.name}>
                        {g.name}
                      </option>
                    ))}
                    {formData.group && !lookups.groups.some(g => g.name === formData.group) && (
                      <option value={formData.group}>{formData.group}</option>
                    )}
                    <option value="__custom__">+ Add new group...</option>
                  </select>
                ) : (
                  <div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <input
                        id="cat_group_custom"
                        type="text"
                        required
                        className="input"
                        placeholder="Enter new group name"
                        value={customGroupName}
                        onChange={(e) => setCustomGroupName(e.target.value)}
                        autoFocus
                      />
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: '0 10px', fontSize: '12px', whiteSpace: 'nowrap' }}
                        onClick={() => {
                          setIsCustomGroup(false);
                          setCustomGroupName('');
                          setFormData(prev => ({
                            ...prev,
                            group: lookups.groups[0]?.name || 'Office – Fixed'
                          }));
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="field">
                <label htmlFor="cat_linked" className="lbl">Usually linked to</label>
                <select
                  id="cat_linked"
                  className="select"
                  value={formData.partyKind.toLowerCase()}
                  onChange={(e) => setFormData(prev => ({ ...prev, partyKind: e.target.value }))}
                >
                  {lookups.linkedTo.map(l => (
                    <option key={l.id || l.name} value={l.name.toLowerCase()}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Nature & SAC code */}
            <div className="row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="field">
                <label htmlFor="cat_nature" className="lbl">Nature</label>
                <select
                  id="cat_nature"
                  className="select"
                  value={formData.kind}
                  onChange={(e) => setFormData(prev => ({ ...prev, kind: e.target.value }))}
                >
                  {lookups.natures.map(n => {
                    const val = {
                      'Operating': 'operating',
                      'Statutory / Tax': 'tax',
                      'Capex': 'capex',
                      'Financing / Owner': 'financing'
                    }[n.name as string] || n.name.toLowerCase();
                    return (
                      <option key={n.id || n.name} value={val}>
                        {n.name}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className="field">
                <label htmlFor="cat_sac" className="lbl">SAC code</label>
                <input
                  id="cat_sac"
                  type="text"
                  className="input"
                  placeholder="e.g. 998311"
                  value={formData.sac}
                  onChange={(e) => setFormData(prev => ({ ...prev, sac: e.target.value }))}
                />
                <div className="hint" style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '3px' }}>
                  For receipts: printed in the GST sales register. Confirm codes with your CA.
                </div>
              </div>
            </div>

            {/* Input GST on bills & TDS Section */}
            <div className="row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="field">
                <label htmlFor="cat_itc" className="lbl">Input GST on bills</label>
                <select
                  id="cat_itc"
                  className="select"
                  value={formData.itcBlocked ? '1' : ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, itcBlocked: e.target.value === '1' }))}
                >
                  {(lookups.inputGstOnBills && lookups.inputGstOnBills.length > 0
                    ? lookups.inputGstOnBills.filter((g: any) => g.is_active !== false)
                    : DEFAULT_LOOKUPS.inputGstOnBills
                  ).map((g: any) => {
                    const isBlocked = g.value === 'blocked_not_claimable' || (g.label || '').toLowerCase().includes('blocked');
                    return (
                      <option key={g.id || g.value} value={isBlocked ? '1' : ''}>
                        {g.label}
                      </option>
                    );
                  })}
                </select>
                <div className="hint" style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '3px' }}>
                  {formData.itcBlocked
                    ? (lookups.inputGstOnBills?.find((g: any) => g.value === 'blocked_not_claimable')?.description || 'Blocked: food, gifts, personal use, motor vehicles (Sec. 17(5))')
                    : (lookups.inputGstOnBills?.find((g: any) => g.value === 'claimable_itc')?.description || 'Input GST eligible for input tax credit, subject to applicable rules.')}
                </div>
              </div>

              <div className="field">
                <label htmlFor="cat_tds" className="lbl">TDS section (payments)</label>
                <select
                  id="cat_tds"
                  className="select"
                  value={formData.tdsSection}
                  onChange={(e) => setFormData(prev => ({ ...prev, tdsSection: e.target.value }))}
                >
                  <option value="">—</option>
                  {lookups.tdsSections.map(s => (
                    <option key={s.id || s.code} value={s.code}>
                      {s.code}{s.description ? ` · ${s.description}` : ''}
                    </option>
                  ))}
                </select>
                <div className="hint" style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '3px' }}>
                  Suggested on payments in this category; changeable per entry
                </div>
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
              {isSubmitting ? 'Saving to Supabase...' : 'Save Category'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
