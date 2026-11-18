import { useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { SupabaseService } from '../lib/supabase';

export interface PersonContact {
  id?: string;
  name: string;
  designation: string;
  email: string;
  phone: string;
  receives_accounts: boolean;
  receives_projects: boolean;
  receives_management: boolean;
  on_whatsapp: boolean;
}

export interface VendorFormData {
  // Company Tab
  vendor_name: string;
  gstin: string;
  state: string;
  billing_address: string;
  pin_code: string;

  // People Tab
  people: PersonContact[];

  // Tax, terms & bank Tab
  pan: string;
  default_gst_type: string;
  credit_period: number | string;
  notes: string;
  account_holder_name: string;
  bank_name: string;
  account_number: string;
  ifsc_code: string;
  upi_id: string;
}

export type TabType = 'company' | 'people' | 'tax_bank';

export const createEmptyPerson = (receivesAccountsDefault = true): PersonContact => ({
  name: '',
  designation: '',
  email: '',
  phone: '',
  receives_accounts: receivesAccountsDefault,
  receives_projects: false,
  receives_management: false,
  on_whatsapp: false
});

export const initialVendorFormData: VendorFormData = {
  vendor_name: '',
  gstin: '',
  state: '',
  billing_address: '',
  pin_code: '',
  people: [createEmptyPerson(true)],
  pan: '',
  default_gst_type: 'CGST + SGST',
  credit_period: 30,
  notes: '',
  account_holder_name: '',
  bank_name: '',
  account_number: '',
  ifsc_code: '',
  upi_id: ''
};

interface UseAddVendorFormOptions {
  onSuccess?: (newVendor: any) => void;
  onClose?: () => void;
}

export function useAddVendorForm(options: UseAddVendorFormOptions = {}) {
  const { onSuccess, onClose } = options;

  const [formData, setFormData] = useState<VendorFormData>(initialVendorFormData);
  const [activeTab, setActiveTab] = useState<TabType>('company');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleFieldChange = useCallback((field: keyof Omit<VendorFormData, 'people'>, value: any) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value
    }));
    setErrorMessage(null);
  }, []);

  const handleAddPerson = useCallback(() => {
    setFormData((prev) => ({
      ...prev,
      people: [...prev.people, createEmptyPerson(false)]
    }));
  }, []);

  const handleRemovePerson = useCallback((index: number) => {
    setFormData((prev) => {
      if (prev.people.length <= 1) {
        return {
          ...prev,
          people: [createEmptyPerson(true)]
        };
      }
      return {
        ...prev,
        people: prev.people.filter((_, i) => i !== index)
      };
    });
  }, []);

  const handlePersonChange = useCallback(
    (index: number, field: keyof PersonContact, value: any) => {
      setFormData((prev) => {
        const nextPeople = [...prev.people];
        nextPeople[index] = {
          ...nextPeople[index],
          [field]: value
        };
        return {
          ...prev,
          people: nextPeople
        };
      });
      setErrorMessage(null);
    },
    []
  );

  const resetForm = useCallback(() => {
    setFormData(initialVendorFormData);
    setActiveTab('company');
    setErrorMessage(null);
    setIsSubmitting(false);
  }, []);

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      if (e) e.preventDefault();
      setErrorMessage(null);

      if (!formData.vendor_name.trim()) {
        const err = 'Vendor name is required.';
        setErrorMessage(err);
        setActiveTab('company');
        return;
      }

      setIsSubmitting(true);

      try {
        const res = await SupabaseService.saveVendor(
          {
            vendor_name: formData.vendor_name.trim(),
            gstin: formData.gstin.trim(),
            state: formData.state.trim(),
            billing_address: formData.billing_address.trim(),
            pin_code: formData.pin_code.trim()
          },
          formData.people,
          {
            pan: formData.pan.trim(),
            default_gst_type: formData.default_gst_type,
            credit_period: formData.credit_period,
            notes: formData.notes.trim(),
            account_holder_name: formData.account_holder_name.trim(),
            bank_name: formData.bank_name.trim(),
            account_number: formData.account_number.trim(),
            ifsc_code: formData.ifsc_code.trim(),
            upi_id: formData.upi_id.trim()
          }
        );

        if (res && res.vendor) {
          const completeVendor = {
            ...res.vendor,
            people: res.people || []
          };
          if (onSuccess) onSuccess(completeVendor);
          resetForm();
          if (onClose) onClose();
        }
      } catch (err: any) {
        console.error('Error saving vendor to Supabase:', err);
        setErrorMessage(err.message || 'Failed to save vendor to Supabase.');
      } finally {
        setIsSubmitting(false);
      }
    },
    [formData, onSuccess, onClose, resetForm]
  );

  return {
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
  };
}
