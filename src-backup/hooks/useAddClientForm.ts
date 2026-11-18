import { useState, useCallback, useMemo } from 'react';
import { supabase } from '../supabaseClient';

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

export interface ClientFormData {
  // Company Tab
  client_name: string;
  gstin: string;
  state: string;
  billing_address: string;
  pin_code: string;

  // People Tab
  people: PersonContact[];

  // Tax, terms & bank Tab
  pan: string;
  tan: string;
  default_gst_type: string;
  credit_period: number | string;
  notes: string;
  bank_account_name: string;
  bank_account_number: string;
  bank_ifsc: string;
  bank_name: string;
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

export const initialClientFormData: ClientFormData = {
  client_name: '',
  gstin: '',
  state: '',
  billing_address: '',
  pin_code: '',
  people: [createEmptyPerson(true)],
  pan: '',
  tan: '',
  default_gst_type: 'CGST + SGST',
  credit_period: 30,
  notes: '',
  bank_account_name: '',
  bank_account_number: '',
  bank_ifsc: '',
  bank_name: ''
};

interface UseAddClientFormOptions {
  onSuccess?: (newClient: any) => void;
  onClose?: () => void;
  customSupabaseClient?: typeof supabase;
}

export function useAddClientForm(options: UseAddClientFormOptions = {}) {
  const { onSuccess, onClose, customSupabaseClient } = options;
  const db = customSupabaseClient || supabase;

  // Single state object holding all form data
  const [formData, setFormData] = useState<ClientFormData>(initialClientFormData);
  const [activeTab, setActiveTab] = useState<TabType>('company');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Field change handler for top-level form fields
  const handleFieldChange = useCallback((field: keyof Omit<ClientFormData, 'people'>, value: any) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value
    }));
    setErrorMessage(null);
  }, []);

  // Handler for adding a new contact person
  const handleAddPerson = useCallback(() => {
    setFormData((prev) => ({
      ...prev,
      people: [...prev.people, createEmptyPerson(false)]
    }));
  }, []);

  // Handler for removing a contact person
  const handleRemovePerson = useCallback((index: number) => {
    setFormData((prev) => {
      if (prev.people.length <= 1) {
        // Keep at least one person row, just reset fields
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

  // Handler for updating a specific field on a contact person
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

  // Reset form to pristine state
  const resetForm = useCallback(() => {
    setFormData(initialClientFormData);
    setActiveTab('company');
    setErrorMessage(null);
    setIsSubmitting(false);
  }, []);

  // Validation: Check if at least one contact has an email and receives_accounts = true
  const hasAccountsEmail = useMemo(() => {
    return formData.people.some(
      (person) =>
        Boolean(person.email && person.email.trim().length > 0) &&
        Boolean(person.receives_accounts)
    );
  }, [formData.people]);

  // Main Submit Logic (Sequential Supabase calls)
  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      if (e) e.preventDefault();

      setErrorMessage(null);

      // Validation 1: Client / Company Name is required
      if (!formData.client_name.trim()) {
        const err = 'Client / Company Name is required.';
        setErrorMessage(err);
        setActiveTab('company');
        return;
      }

      // Validation 2: UI Logic Warning Check for payment email
      if (!hasAccountsEmail) {
        const warning = 'No email yet — add one so payment emails can go out';
        setErrorMessage(warning);
        setActiveTab('people');
        alert(`Validation Check Failed:\n\n${warning}\n\nPlease ensure at least one contact has an email address and has 'Receives accounts' enabled.`);
        return;
      }

      setIsSubmitting(true);

      try {
        // STEP 1: Insert into fss_client table & retrieve newly generated ID
        const clientPayload = {
          client_name: formData.client_name.trim(),
          gstin: formData.gstin.trim() || null,
          state: formData.state.trim() || null,
          billing_address: formData.billing_address.trim() || null,
          pin_code: formData.pin_code.trim() || null,
          pan: formData.pan.trim() || null,
          tan: formData.tan.trim() || null,
          default_gst_type: formData.default_gst_type || 'CGST + SGST',
          credit_period: Number(formData.credit_period) || 30,
          notes: formData.notes.trim() || null,
          bank_account_name: formData.bank_account_name.trim() || null,
          bank_account_number: formData.bank_account_number.trim() || null,
          bank_ifsc: formData.bank_ifsc.trim() || null,
          bank_name: formData.bank_name.trim() || null,
          status: 'Active'
        };

        const { data: newClient, error: clientError } = await db
          .from('fss_client')
          .insert([clientPayload])
          .select()
          .single();

        if (clientError) {
          throw new Error(`Step 1 Failed (fss_client): ${clientError.message}`);
        }

        if (!newClient || !newClient.id) {
          throw new Error('Client record created, but failed to return generated client ID.');
        }

        const newClientId = newClient.id;

        // STEP 2: Map through people array, attach client_id, and bulk insert
        const peoplePayload = formData.people
          .filter((p) => p.name.trim() || p.email.trim() || p.phone.trim() || p.designation.trim())
          .map((person) => ({
            client_id: newClientId,
            name: person.name.trim() || null,
            designation: person.designation.trim() || null,
            email: person.email.trim() || null,
            phone: person.phone.trim() || null,
            receives_accounts: Boolean(person.receives_accounts),
            receives_projects: Boolean(person.receives_projects),
            receives_management: Boolean(person.receives_management),
            on_whatsapp: Boolean(person.on_whatsapp)
          }));

        if (peoplePayload.length > 0) {
          const { error: peopleError } = await db
            .from('fss_client_people')
            .insert(peoplePayload);

          if (peopleError) {
            throw new Error(`Step 2 Failed (fss_client_people): ${peopleError.message}`);
          }
        }

        // Success: Close modal, reset form, and notify parent table to refresh
        newClient.people = peoplePayload;
        resetForm();
        if (onSuccess) {
          onSuccess(newClient);
        }
        if (typeof window !== 'undefined' && (window as any).IuovaCore?.toast) {
          (window as any).IuovaCore.toast('Added ' + newClient.client_name);
        }
        if (onClose) {
          onClose();
        }
      } catch (err: any) {
        console.error('Error submitting Add Client form:', err);
        const errMsg = err?.message || 'An unexpected error occurred while saving the client.';
        setErrorMessage(errMsg);
        alert(`Supabase Insert Failed:\n${errMsg}`);
      } finally {
        setIsSubmitting(false);
      }
    },
    [formData, hasAccountsEmail, db, onSuccess, onClose, resetForm]
  );

  return {
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
  };
}
