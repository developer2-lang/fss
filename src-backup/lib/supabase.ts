import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_2_URL || import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_2_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = Boolean(
  supabaseUrl && supabaseAnonKey && !supabaseUrl.includes('your-project') && !supabaseUrl.includes('placeholder')
);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

export interface SupabaseSyncStatus {
  configured: boolean;
  connected: boolean;
  lastSynced: string | null;
  error?: string | null;
}

export const STATE_CODE_TO_NAME: Record<string, string> = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
  '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan',
  '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh',
  '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura',
  '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand',
  '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '26': 'Dadra & Nagar Haveli and Daman & Diu', '27': 'Maharashtra', '29': 'Karnataka',
  '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu',
  '34': 'Puducherry', '35': 'Andaman & Nicobar', '36': 'Telangana', '37': 'Andhra Pradesh',
  '38': 'Ladakh', '97': 'Other territory', '99': 'Outside India (export / import)'
};

export const STATE_NAME_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_CODE_TO_NAME).map(([code, name]) => [name.toLowerCase(), code])
);

let _categoryLookupsCache: {
  types: any[];
  summaryBuckets: any[];
  groups: any[];
  linkedTo: any[];
  natures: any[];
  tdsSections: any[];
  inputGstOnBills?: any[];
} | null = null;

export const SupabaseService = {
  isConfigured(): boolean {
    return isSupabaseConfigured;
  },

  /**
   * Test connection directly against the fss_client table
   */
  async testConnection(): Promise<boolean> {
    if (!supabase) return false;
    try {
      const { error } = await supabase.from('fss_client').select('id').limit(1);
      return !error;
    } catch {
      return false;
    }
  },

  /**
   * Saves a client record to fss_client and links contact people in fss_client_people.
   * Handles both new client insertion and updating existing client records.
   */
  async saveClient(
    companyData: any,
    peopleArray: any[] = [],
    taxData: any = {}
  ): Promise<{ client: any; people: any[] }> {
    if (!supabase) {
      throw new Error('Supabase is not configured. Please ensure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set.');
    }

    const stateName =
      companyData.state ||
      (companyData.stateCode ? (STATE_CODE_TO_NAME[companyData.stateCode] || companyData.stateCode) : null);

    const clientPayload: Record<string, any> = {
      client_name: (companyData.client_name || companyData.name || '').trim(),
      gstin: (companyData.gstin || '').trim() || null,
      state: stateName || null,
      billing_address: (companyData.billing_address || companyData.address || '').trim() || null,
      pin_code: (companyData.pin_code || companyData.pincode || '').trim() || null,
      pan: (taxData.pan || companyData.pan || '').trim() || null,
      tan: (taxData.tan || companyData.tan || '').trim() || null,
      default_gst_type: taxData.default_gst_type || companyData.default_gst_type || (companyData.gstType === 'inter' ? 'IGST' : 'CGST + SGST'),
      credit_period: Number(taxData.credit_period ?? companyData.credit_period ?? companyData.creditDays) || 30,
      notes: (taxData.notes || companyData.notes || '').trim() || null,
      bank_account_name: (taxData.bank_account_name || companyData.bank?.accName || '').trim() || null,
      bank_account_number: (taxData.bank_account_number || companyData.bank?.accNo || '').trim() || null,
      bank_ifsc: (taxData.bank_ifsc || companyData.bank?.ifsc || '').trim() || null,
      bank_name: (taxData.bank_name || companyData.bank?.bankName || '').trim() || null,
      status: companyData.status || (companyData.active === false ? 'Inactive' : 'Active')
    };

    if (!clientPayload.client_name) {
      throw new Error('Client name is required.');
    }

    const existingId = companyData.id;
    const isExistingUuid =
      existingId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(existingId);

    let client: any = null;

    // 1. Update existing record if valid UUID
    if (isExistingUuid) {
      const { data: updated, error: updateErr } = await supabase
        .from('fss_client')
        .update(clientPayload)
        .eq('id', existingId)
        .select()
        .single();

      if (!updateErr && updated) {
        client = updated;
      }
    }

    // 2. Otherwise insert new client row
    if (!client) {
      const { data: inserted, error: insertErr } = await supabase
        .from('fss_client')
        .insert([clientPayload])
        .select()
        .single();

      if (insertErr) {
        console.error('fss_client insert error:', insertErr);
        throw new Error(`Failed to save client: ${insertErr.message}`);
      }
      client = inserted;
    }

    if (!client || !client.id) {
      throw new Error('Client record saved, but no generated ID was returned.');
    }

    let insertedPeople: any[] = [];

    // 3. Sync contact personnel in fss_client_people
    if (isExistingUuid) {
      // Clear previous contacts if updating
      await supabase.from('fss_client_people').delete().eq('client_id', client.id);
    }

    if (peopleArray && peopleArray.length > 0) {
      const peopleToInsert = peopleArray
        .filter((person: any) => person.name?.trim() || person.email?.trim() || person.phone?.trim() || person.designation?.trim())
        .map((person: any) => ({
          client_id: client.id,
          name: person.name ? String(person.name).trim() : null,
          designation: person.designation ? String(person.designation).trim() : null,
          email: person.email ? String(person.email).trim() : null,
          phone: person.phone ? String(person.phone).trim() : null,
          receives_accounts: person.receives_accounts != null ? Boolean(person.receives_accounts) : person.receivesAccounts != null ? Boolean(person.receivesAccounts) : (person.tags || []).includes('accounts'),
          receives_projects: person.receives_projects != null ? Boolean(person.receives_projects) : person.receivesProjects != null ? Boolean(person.receivesProjects) : (person.tags || []).includes('projects'),
          receives_management: person.receives_management != null ? Boolean(person.receives_management) : person.receivesManagement != null ? Boolean(person.receivesManagement) : (person.tags || []).includes('management'),
          on_whatsapp: person.on_whatsapp != null ? Boolean(person.on_whatsapp) : person.whatsapp != null ? Boolean(person.whatsapp) : false
        }));

      if (peopleToInsert.length > 0) {
        const { data: pData, error: peopleError } = await supabase
          .from('fss_client_people')
          .insert(peopleToInsert)
          .select();

        if (peopleError) {
          console.error('fss_client_people insert error:', peopleError);
        } else {
          insertedPeople = pData || [];
        }
      }
    }

    return { client, people: insertedPeople };
  },

  /**
   * Loads all clients from fss_client joined with contacts from fss_client_people
   */
  async loadClientsFromSupabase(): Promise<any[]> {
    if (!supabase) return [];
    try {
      const { data: clients, error: clientErr } = await supabase
        .from('fss_client')
        .select('*')
        .order('created_at', { ascending: false });

      if (clientErr) {
        console.warn('Error fetching fss_client:', clientErr.message);
        return [];
      }
      if (!clients || !clients.length) return [];

      const { data: people, error: peopleErr } = await supabase
        .from('fss_client_people')
        .select('*');

      if (peopleErr) {
        console.warn('Error fetching fss_client_people:', peopleErr.message);
      }

      const peopleByClient: Record<string, any[]> = {};
      (people || []).forEach((p: any) => {
        if (!peopleByClient[p.client_id]) peopleByClient[p.client_id] = [];
        peopleByClient[p.client_id].push(p);
      });

      return clients.map((c: any) => ({
        ...c,
        people: peopleByClient[c.id] || []
      }));
    } catch (err) {
      console.error('Error in loadClientsFromSupabase:', err);
      return [];
    }
  },

  /**
   * Deletes a client and their contacts from fss_client and fss_client_people
   */
  async deleteClient(clientId: string): Promise<boolean> {
    if (!supabase || !clientId) return false;
    try {
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)) {
        await supabase.from('fss_client_people').delete().eq('client_id', clientId);
        const { error } = await supabase.from('fss_client').delete().eq('id', clientId);
        if (error) {
          console.error('Error deleting client from fss_client:', error.message);
          return false;
        }
      }
      return true;
    } catch (err) {
      console.error('Exception deleting client:', err);
      return false;
    }
  },

  /**
   * Syncs local clients into Supabase fss_client if the remote table is empty
   */
  async syncLocalClientsToSupabase(localParties: any[]): Promise<any[]> {
    if (!supabase) return [];
    const clientParties = (localParties || []).filter((p: any) => p.kind === 'client' && p.name?.trim());
    const syncedClients: any[] = [];

    for (const cp of clientParties) {
      try {
        const res = await this.saveClient(cp, cp.contacts || [], {
          pan: cp.pan,
          tan: cp.tan,
          default_gst_type: cp.gstType === 'inter' ? 'IGST' : 'CGST + SGST',
          credit_period: cp.creditDays,
          notes: cp.notes,
          bank_account_name: cp.bank?.accName,
          bank_account_number: cp.bank?.accNo,
          bank_ifsc: cp.bank?.ifsc,
          bank_name: cp.bank?.bankName
        });
        if (res?.client) {
          syncedClients.push(res.client);
        }
      } catch (e) {
        console.warn('Failed to sync client to Supabase:', cp.name, e);
      }
    }
    return syncedClients;
  },

  /**
   * Saves a vendor record to fss_vendor and links contact people in fss_vendor_people.
   * Handles both new vendor insertion and updating existing vendor records.
   */
  async saveVendor(
    vendorData: any,
    peopleArray: any[] = [],
    taxBankData: any = {}
  ): Promise<{ vendor: any; people: any[] }> {
    if (!supabase) {
      throw new Error('Supabase is not configured. Please ensure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set.');
    }

    const stateName =
      vendorData.state ||
      (vendorData.stateCode ? (STATE_CODE_TO_NAME[vendorData.stateCode] || vendorData.stateCode) : null);

    const vendorPayload: Record<string, any> = {
      vendor_name: (vendorData.vendor_name || vendorData.name || '').trim(),
      gstin: (vendorData.gstin || '').trim() || null,
      state: stateName || null,
      billing_address: (vendorData.billing_address || vendorData.address || '').trim() || null,
      pin_code: (vendorData.pin_code || vendorData.pincode || '').trim() || null,
      pan: (taxBankData.pan || vendorData.pan || '').trim() || null,
      default_gst_type: taxBankData.default_gst_type || vendorData.default_gst_type || (vendorData.gstType === 'inter' ? 'IGST' : 'CGST + SGST'),
      credit_period: Number(taxBankData.credit_period ?? vendorData.credit_period ?? vendorData.creditDays) || 0,
      notes: (taxBankData.notes || vendorData.notes || '').trim() || null,
      account_holder_name: (taxBankData.account_holder_name || vendorData.bank?.accName || '').trim() || null,
      account_number: (taxBankData.account_number || vendorData.bank?.accNo || '').trim() || null,
      bank_name: (taxBankData.bank_name || vendorData.bank?.bankName || '').trim() || null,
      ifsc_code: (taxBankData.ifsc_code || vendorData.bank?.ifsc || '').trim() || null,
      upi_id: (taxBankData.upi_id || vendorData.bank?.upi || '').trim() || null,
      status: vendorData.status || (vendorData.active === false ? 'Inactive' : 'Active')
    };

    if (!vendorPayload.vendor_name) {
      throw new Error('Vendor name is required.');
    }

    const existingId = vendorData.id;
    const isExistingUuid =
      existingId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(existingId);

    let vendor: any = null;

    // 1. Update existing vendor if valid UUID
    if (isExistingUuid) {
      const { data: updated, error: updateErr } = await supabase
        .from('fss_vendor')
        .update(vendorPayload)
        .eq('id', existingId)
        .select()
        .single();

      if (!updateErr && updated) {
        vendor = updated;
      }
    }

    // 2. Otherwise insert new vendor row
    if (!vendor) {
      const { data: inserted, error: insertErr } = await supabase
        .from('fss_vendor')
        .insert([vendorPayload])
        .select()
        .single();

      if (insertErr) {
        console.error('fss_vendor insert error:', insertErr);
        throw new Error(`Failed to save vendor: ${insertErr.message}`);
      }
      vendor = inserted;
    }

    if (!vendor || !vendor.id) {
      throw new Error('Vendor record saved, but no generated ID was returned.');
    }

    let insertedPeople: any[] = [];

    // 3. Sync contact personnel in fss_vendor_people
    if (isExistingUuid) {
      await supabase.from('fss_vendor_people').delete().eq('vendor_id', vendor.id);
    }

    if (peopleArray && peopleArray.length > 0) {
      const peopleToInsert = peopleArray
        .filter((person: any) => person.name?.trim() || person.email?.trim() || person.phone?.trim() || person.designation?.trim())
        .map((person: any) => ({
          vendor_id: vendor.id,
          name: person.name ? String(person.name).trim() : null,
          designation: person.designation ? String(person.designation).trim() : null,
          email: person.email ? String(person.email).trim() : null,
          phone: person.phone ? String(person.phone).trim() : null,
          receives_accounts: person.receives_accounts != null ? Boolean(person.receives_accounts) : person.receivesAccounts != null ? Boolean(person.receivesAccounts) : (person.tags || []).includes('accounts'),
          receives_projects: person.receives_projects != null ? Boolean(person.receives_projects) : person.receivesProjects != null ? Boolean(person.receivesProjects) : (person.tags || []).includes('projects'),
          receives_management: person.receives_management != null ? Boolean(person.receives_management) : person.receivesManagement != null ? Boolean(person.receivesManagement) : (person.tags || []).includes('management'),
          on_whatsapp: person.on_whatsapp != null ? Boolean(person.on_whatsapp) : person.whatsapp != null ? Boolean(person.whatsapp) : false
        }));

      if (peopleToInsert.length > 0) {
        const { data: pData, error: peopleError } = await supabase
          .from('fss_vendor_people')
          .insert(peopleToInsert)
          .select();

        if (peopleError) {
          console.error('fss_vendor_people insert error:', peopleError);
        } else {
          insertedPeople = pData || [];
        }
      }
    }

    return { vendor, people: insertedPeople };
  },

  /**
   * Loads all vendors from fss_vendor joined with contacts from fss_vendor_people
   */
  async loadVendorsFromSupabase(): Promise<any[]> {
    if (!supabase) return [];
    try {
      const { data: vendors, error: vendorErr } = await supabase
        .from('fss_vendor')
        .select('*')
        .order('created_at', { ascending: false });

      if (vendorErr) {
        console.warn('Error fetching fss_vendor:', vendorErr.message);
        return [];
      }
      if (!vendors || !vendors.length) return [];

      const { data: people, error: peopleErr } = await supabase
        .from('fss_vendor_people')
        .select('*');

      if (peopleErr) {
        console.warn('Error fetching fss_vendor_people:', peopleErr.message);
      }

      const peopleByVendor: Record<string, any[]> = {};
      (people || []).forEach((p: any) => {
        if (!peopleByVendor[p.vendor_id]) peopleByVendor[p.vendor_id] = [];
        peopleByVendor[p.vendor_id].push(p);
      });

      return vendors.map((v: any) => ({
        ...v,
        people: peopleByVendor[v.id] || []
      }));
    } catch (err) {
      console.error('Error in loadVendorsFromSupabase:', err);
      return [];
    }
  },

  /**
   * Deletes a vendor and their contacts from fss_vendor and fss_vendor_people
   */
  async deleteVendor(vendorId: string): Promise<boolean> {
    if (!supabase || !vendorId) return false;
    try {
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(vendorId)) {
        await supabase.from('fss_vendor_people').delete().eq('vendor_id', vendorId);
        const { error } = await supabase.from('fss_vendor').delete().eq('id', vendorId);
        if (error) {
          console.error('Error deleting vendor from fss_vendor:', error.message);
          return false;
        }
      }
      return true;
    } catch (err) {
      console.error('Exception deleting vendor:', err);
      return false;
    }
  },

  /**
   * Syncs local vendors into Supabase fss_vendor if the remote table is empty
   */
  async syncLocalVendorsToSupabase(localParties: any[]): Promise<any[]> {
    if (!supabase) return [];
    const vendorParties = (localParties || []).filter((p: any) => p.kind === 'vendor' && p.name?.trim());
    const syncedVendors: any[] = [];

    for (const vp of vendorParties) {
      try {
        const res = await this.saveVendor(vp, vp.contacts || [], {
          pan: vp.pan,
          default_gst_type: vp.gstType === 'inter' ? 'IGST' : 'CGST + SGST',
          credit_period: vp.creditDays,
          notes: vp.notes,
          account_holder_name: vp.bank?.accName,
          account_number: vp.bank?.accNo,
          bank_name: vp.bank?.bankName,
          ifsc_code: vp.bank?.ifsc,
          upi_id: vp.bank?.upi
        });
        if (res?.vendor) {
          syncedVendors.push(res.vendor);
        }
      } catch (e) {
        console.warn('Failed to sync vendor to Supabase:', vp.name, e);
      }
    }
    return syncedVendors;
  },

  /**
   * Saves an employee record to fss_employe table.
   * Handles both new employee insertion and updating existing employee records.
   */
  async saveEmployee(empData: any): Promise<any> {
    if (!supabase) {
      throw new Error('Supabase is not configured. Please ensure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set.');
    }

    const name = (empData.name || '').trim();
    if (!name) {
      throw new Error('Employee name is required.');
    }

    const department = (empData.department || '').trim();
    if (!department) {
      throw new Error('Employee department is required.');
    }

    const payload: Record<string, any> = {
      name,
      department,
      designation: (empData.designation || '').trim() || null,
      monthly_salary: Number(empData.monthly_salary ?? empData.monthlySalary) || 0,
      joined: empData.joined || empData.joinDate || null,
      emails: (empData.emails || empData.email || '').trim() || null,
      phone: (empData.phone || '').trim() || null,
      is_active: empData.is_active != null ? Boolean(empData.is_active) : (empData.active != null ? Boolean(empData.active) : true),
      updated_at: new Date().toISOString()
    };

    const existingId = empData.supabase_id || (!isNaN(Number(empData.id)) ? Number(empData.id) : null);

    let employee: any = null;

    // 1. Update existing record if valid numeric ID
    if (existingId) {
      const { data: updated, error: updateErr } = await supabase
        .from('fss_employe')
        .update(payload)
        .eq('id', existingId)
        .select()
        .single();

      if (!updateErr && updated) {
        employee = updated;
      }
    }

    // 2. Otherwise insert new employee row
    if (!employee) {
      const { data: inserted, error: insertErr } = await supabase
        .from('fss_employe')
        .insert([payload])
        .select()
        .single();

      if (insertErr) {
        console.error('fss_employe insert error:', insertErr);
        throw new Error(`Failed to save employee: ${insertErr.message}`);
      }
      employee = inserted;
    }

    if (!employee || !employee.id) {
      throw new Error('Employee record saved, but no generated ID was returned.');
    }

    return employee;
  },

  /**
   * Loads all employees from fss_employe
   */
  async loadEmployeesFromSupabase(): Promise<any[]> {
    if (!supabase) return [];
    try {
      const { data: employees, error: empErr } = await supabase
        .from('fss_employe')
        .select('*')
        .order('name', { ascending: true });

      if (empErr) {
        console.warn('Error fetching fss_employe:', empErr.message);
        return [];
      }
      return employees || [];
    } catch (err) {
      console.error('Error in loadEmployeesFromSupabase:', err);
      return [];
    }
  },

  /**
   * Deletes an employee from fss_employe
   */
  async deleteEmployee(employeeId: string | number): Promise<boolean> {
    if (!supabase || !employeeId) return false;
    try {
      const numId = Number(employeeId);
      if (!isNaN(numId)) {
        const { error } = await supabase.from('fss_employe').delete().eq('id', numId);
        if (error) {
          console.error('Error deleting employee from fss_employe:', error.message);
          return false;
        }
      }
      return true;
    } catch (err) {
      console.error('Exception deleting employee:', err);
      return false;
    }
  },

  /**
   * Syncs local employees into Supabase fss_employe if the remote table is empty
   */
  async syncLocalEmployeesToSupabase(localParties: any[], departments: any[] = []): Promise<any[]> {
    if (!supabase) return [];
    const empParties = (localParties || []).filter((p: any) => p.kind === 'employee' && p.name?.trim());
    const syncedEmps: any[] = [];

    const deptMap: Record<string, string> = {};
    (departments || []).forEach((d: any) => {
      deptMap[d.id] = d.name;
    });

    for (const ep of empParties) {
      try {
        const deptName = deptMap[ep.departmentId] || ep.department || ep.departmentId || 'Operations / Admin';
        const res = await this.saveEmployee({
          name: ep.name,
          department: deptName,
          designation: ep.designation,
          monthly_salary: ep.monthlySalary,
          joined: ep.joinDate,
          emails: ep.email,
          phone: ep.phone,
          is_active: ep.active !== false
        });
        if (res) {
          ep.supabase_id = res.id;
          syncedEmps.push(res);
        }
      } catch (e) {
        console.warn('Failed to sync employee to Supabase:', ep.name, e);
      }
    }
    return syncedEmps;
  },

  /**
   * Saves or updates an other party in fss_other_parties
   */
  async saveOtherParty(partyData: {
    supabase_id?: number | string | null;
    id?: number | string | null;
    name: string;
    gstin?: string | null;
    default_gst_type?: string | null;
    gstType?: string | null;
    emails?: string | null;
    email?: string | null;
    phone?: string | null;
    is_active?: boolean;
    active?: boolean;
  }): Promise<any> {
    if (!supabase) {
      throw new Error('Supabase is not configured. Please check your .env configuration.');
    }

    if (!partyData.name || !partyData.name.trim()) {
      throw new Error('Other party name is required.');
    }

    let defaultGstType = 'No GST';
    const rawGst = (partyData.default_gst_type || partyData.gstType || '').trim();
    if (['Regular GST', 'intra', 'inter', 'CGST + SGST', 'IGST'].includes(rawGst)) {
      defaultGstType = 'Regular GST';
    } else if (rawGst === 'Composition GST') {
      defaultGstType = 'Composition GST';
    } else if (rawGst === 'Unregistered') {
      defaultGstType = 'Unregistered';
    } else {
      defaultGstType = 'No GST';
    }

    const payload: any = {
      name: partyData.name.trim(),
      gstin: (partyData.gstin || '').trim().toUpperCase() || null,
      default_gst_type: defaultGstType,
      emails: (partyData.emails || partyData.email || '').trim() || null,
      phone: (partyData.phone || '').trim() || null,
      is_active: partyData.is_active != null ? Boolean(partyData.is_active) : (partyData.active != null ? Boolean(partyData.active) : true),
      updated_at: new Date().toISOString()
    };

    const existingId = partyData.supabase_id || (!isNaN(Number(partyData.id)) ? Number(partyData.id) : null);

    let otherParty: any = null;

    // 1. Update existing record if valid numeric ID
    if (existingId) {
      const { data: updated, error: updateErr } = await supabase
        .from('fss_other_parties')
        .update(payload)
        .eq('id', existingId)
        .select()
        .single();

      if (!updateErr && updated) {
        otherParty = updated;
      }
    }

    // 2. Otherwise insert new other party row
    if (!otherParty) {
      const { data: inserted, error: insertErr } = await supabase
        .from('fss_other_parties')
        .insert([payload])
        .select()
        .single();

      if (insertErr) {
        console.error('fss_other_parties insert error:', insertErr);
        throw new Error(`Failed to save other party: ${insertErr.message}`);
      }
      otherParty = inserted;
    }

    if (!otherParty || !otherParty.id) {
      throw new Error('Other party record saved, but no generated ID was returned.');
    }

    return otherParty;
  },

  /**
   * Loads all other parties from fss_other_parties
   */
  async loadOtherPartiesFromSupabase(): Promise<any[]> {
    if (!supabase) return [];
    try {
      const { data: parties, error: partyErr } = await supabase
        .from('fss_other_parties')
        .select('*')
        .order('id', { ascending: true });

      if (partyErr) {
        console.warn('Error fetching fss_other_parties:', partyErr.message);
        return [];
      }
      return parties || [];
    } catch (err) {
      console.error('Error in loadOtherPartiesFromSupabase:', err);
      return [];
    }
  },

  /**
   * Deletes an other party from fss_other_parties
   */
  async deleteOtherParty(partyId: string | number): Promise<boolean> {
    if (!supabase || !partyId) return false;
    try {
      const numId = Number(partyId);
      if (!isNaN(numId)) {
        const { error } = await supabase.from('fss_other_parties').delete().eq('id', numId);
        if (error) {
          console.error('Error deleting other party from fss_other_parties:', error.message);
          return false;
        }
      }
      return true;
    } catch (err) {
      console.error('Exception deleting other party:', err);
      return false;
    }
  },

  /**
   * Syncs local other parties into Supabase fss_other_parties if the remote table is empty
   */
  async syncLocalOtherPartiesToSupabase(localParties: any[]): Promise<any[]> {
    if (!supabase) return [];
    const otherParties = (localParties || []).filter((p: any) => p.kind === 'other' && p.name?.trim());
    const syncedParties: any[] = [];

    // Check existing records to prevent duplicate insertion
    const { data: existing } = await supabase.from('fss_other_parties').select('id, name');
    const existingNames = new Set((existing || []).map((e: any) => e.name.trim().toLowerCase()));

    for (const op of otherParties) {
      try {
        if (existingNames.has(op.name.trim().toLowerCase())) {
          const match = (existing || []).find((e: any) => e.name.trim().toLowerCase() === op.name.trim().toLowerCase());
          if (match) op.supabase_id = match.id;
          continue;
        }
        const res = await this.saveOtherParty({
          name: op.name,
          gstin: op.gstin,
          default_gst_type: op.gstType,
          emails: op.email,
          phone: op.phone,
          is_active: op.active !== false
        });
        if (res) {
          op.supabase_id = res.id;
          syncedParties.push(res);
          existingNames.add(op.name.trim().toLowerCase());
        }
      } catch (e) {
        console.warn('Failed to sync other party to Supabase:', op.name, e);
      }
    }
    return syncedParties;
  },

  /**
   * Saves or updates a project in fss_projects
   */
  async saveProject(
    projectData: {
      supabase_id?: number | string | null;
      id?: number | string | null;
      project_code?: string;
      code?: string;
      project_name?: string;
      name?: string;
      client_id?: number | string;
      clientId?: number | string;
      department?: string;
      departmentId?: string;
      contract_value?: number | null;
      contractValue?: number | null;
      start_date?: string | null;
      startDate?: string | null;
      status?: string;
    },
    clientsList: any[] = []
  ): Promise<any> {
    if (!supabase) {
      throw new Error('Supabase is not configured. Please check your .env configuration.');
    }

    const code = (projectData.project_code || projectData.code || '').trim();
    if (!code) {
      throw new Error('Project code is required.');
    }

    const name = (projectData.project_name || projectData.name || '').trim();
    if (!name) {
      throw new Error('Project name is required.');
    }

    let status = 'Active';
    const rawStatus = (projectData.status || '').toLowerCase().trim();
    if (rawStatus === 'completed') status = 'Completed';
    else if (rawStatus === 'on hold' || rawStatus === 'on-hold') status = 'On Hold';
    else if (rawStatus === 'inactive') status = 'Inactive';
    else status = 'Active';

    // Resolve client_id to positive BIGINT integer
    let clientIdNum = 1;
    const rawClientId = projectData.client_id ?? projectData.clientId;
    if (typeof rawClientId === 'number' && !isNaN(rawClientId) && rawClientId > 0) {
      clientIdNum = rawClientId;
    } else {
      const strId = String(rawClientId || '').trim();
      const parsed = Number(strId);
      if (!isNaN(parsed) && parsed > 0) {
        clientIdNum = parsed;
      } else if (clientsList && clientsList.length > 0) {
        const clientParties = clientsList.filter((c: any) => c.kind === 'client');
        const idx = clientParties.findIndex((c: any) => c.id === strId || c.supabase_id === strId);
        clientIdNum = idx >= 0 ? idx + 1 : 1;
      } else {
        let hash = 0;
        for (let i = 0; i < strId.length; i++) {
          hash = (hash * 31 + strId.charCodeAt(i)) & 0x7fffffff;
        }
        clientIdNum = (hash % 100000) + 1;
      }
    }

    const contractVal = Number(projectData.contract_value ?? projectData.contractValue) || 0;

    const payload: any = {
      project_code: code,
      project_name: name,
      client_id: clientIdNum,
      department: (projectData.department || projectData.departmentId || 'Design').trim(),
      contract_value: contractVal >= 0 ? contractVal : 0,
      start_date: projectData.start_date || projectData.startDate || null,
      status,
      updated_at: new Date().toISOString()
    };

    const existingId = projectData.supabase_id || (!isNaN(Number(projectData.id)) ? Number(projectData.id) : null);
    let project: any = null;

    // 1. Try update by numeric ID
    if (existingId) {
      const { data: updated, error: updateErr } = await supabase
        .from('fss_projects')
        .update(payload)
        .eq('id', existingId)
        .select()
        .single();

      if (!updateErr && updated) {
        project = updated;
      }
    }

    // 2. Try update by unique project_code
    if (!project && payload.project_code) {
      const { data: updatedByCode, error: updateCodeErr } = await supabase
        .from('fss_projects')
        .update(payload)
        .eq('project_code', payload.project_code)
        .select()
        .single();

      if (!updateCodeErr && updatedByCode) {
        project = updatedByCode;
      }
    }

    // 3. Otherwise insert new project
    if (!project) {
      const { data: inserted, error: insertErr } = await supabase
        .from('fss_projects')
        .insert([payload])
        .select()
        .single();

      if (insertErr) {
        console.error('fss_projects insert error:', insertErr);
        throw new Error(`Failed to save project: ${insertErr.message}`);
      }
      project = inserted;
    }

    if (!project || !project.id) {
      throw new Error('Project record saved, but no generated ID was returned.');
    }

    return project;
  },

  /**
   * Loads all projects from fss_projects
   */
  async loadProjectsFromSupabase(): Promise<any[]> {
    if (!supabase) return [];
    try {
      const { data: projects, error: projErr } = await supabase
        .from('fss_projects')
        .select('*')
        .order('project_code', { ascending: true });

      if (projErr) {
        console.warn('Error fetching fss_projects:', projErr.message);
        return [];
      }
      return projects || [];
    } catch (err) {
      console.error('Error in loadProjectsFromSupabase:', err);
      return [];
    }
  },

  /**
   * Deletes a project from fss_projects by id or project_code
   */
  async deleteProject(projectIdOrCode: string | number): Promise<boolean> {
    if (!supabase || !projectIdOrCode) return false;
    try {
      const numId = Number(projectIdOrCode);
      if (!isNaN(numId)) {
        const { error } = await supabase.from('fss_projects').delete().eq('id', numId);
        if (error) {
          console.error('Error deleting project from fss_projects by id:', error.message);
          return false;
        }
      } else {
        const { error } = await supabase.from('fss_projects').delete().eq('project_code', String(projectIdOrCode));
        if (error) {
          console.error('Error deleting project from fss_projects by code:', error.message);
          return false;
        }
      }
      return true;
    } catch (err) {
      console.error('Exception deleting project:', err);
      return false;
    }
  },

  /**
   * Syncs local projects into Supabase fss_projects if the remote table is empty
   */
  async syncLocalProjectsToSupabase(
    localProjects: any[],
    localParties: any[] = [],
    departments: any[] = []
  ): Promise<any[]> {
    if (!supabase) return [];
    const validProjects = (localProjects || []).filter((p: any) => (p.code || p.project_code) && (p.name || p.project_name));
    const syncedProjects: any[] = [];

    // Check existing projects to prevent duplicate insertion
    const { data: existing } = await supabase.from('fss_projects').select('id, project_code');
    const existingCodes = new Set((existing || []).map((e: any) => (e.project_code || '').trim().toLowerCase()));

    const deptMap: Record<string, string> = {};
    (departments || []).forEach((d: any) => {
      deptMap[d.id] = d.name;
    });

    for (const pr of validProjects) {
      try {
        const prCode = (pr.code || pr.project_code || '').trim();
        if (existingCodes.has(prCode.toLowerCase())) {
          const match = (existing || []).find((e: any) => (e.project_code || '').trim().toLowerCase() === prCode.toLowerCase());
          if (match) pr.supabase_id = match.id;
          continue;
        }

        const deptName = deptMap[pr.departmentId] || pr.department || pr.departmentId || 'Design';
        const res = await this.saveProject(
          {
            project_code: prCode,
            project_name: pr.name || pr.project_name,
            client_id: pr.clientId || pr.client_id,
            department: deptName,
            contract_value: pr.contractValue ?? pr.contract_value ?? 0,
            start_date: pr.startDate || pr.start_date || null,
            status: pr.status || 'Active'
          },
          localParties
        );

        if (res) {
          pr.supabase_id = res.id;
          syncedProjects.push(res);
          existingCodes.add(prCode.toLowerCase());
        }
      } catch (e) {
        console.warn('Failed to sync project to Supabase:', pr.code || pr.name, e);
      }
    }
    return syncedProjects;
  },

  /**
   * Saves or updates a department in fss_departments
   */
  async saveDepartment(deptData: {
    supabase_id?: number | string | null;
    id?: number | string | null;
    department_name?: string;
    name?: string;
    manager?: string | null;
    managerName?: string | null;
    manager_email?: string | null;
    managerEmail?: string | null;
  }): Promise<any> {
    if (!supabase) {
      throw new Error('Supabase is not configured. Please check your .env configuration.');
    }

    const deptName = (deptData.department_name || deptData.name || '').trim();
    if (!deptName) {
      throw new Error('Department name is required.');
    }

    const payload: any = {
      department_name: deptName,
      manager: (deptData.manager || deptData.managerName || '').trim() || null,
      manager_email: (deptData.manager_email || deptData.managerEmail || '').trim() || null,
      updated_at: new Date().toISOString()
    };

    const existingId = deptData.supabase_id || (!isNaN(Number(deptData.id)) ? Number(deptData.id) : null);
    let department: any = null;

    // 1. Try update by numeric ID
    if (existingId) {
      const { data: updated, error: updateErr } = await supabase
        .from('fss_departments')
        .update(payload)
        .eq('id', existingId)
        .select()
        .single();

      if (!updateErr && updated) {
        department = updated;
      }
    }

    // 2. Try update by department_name
    if (!department && payload.department_name) {
      const { data: updatedByName, error: updateNameErr } = await supabase
        .from('fss_departments')
        .update(payload)
        .eq('department_name', payload.department_name)
        .select()
        .single();

      if (!updateNameErr && updatedByName) {
        department = updatedByName;
      }
    }

    // 3. Otherwise insert new department
    if (!department) {
      const { data: inserted, error: insertErr } = await supabase
        .from('fss_departments')
        .insert([payload])
        .select()
        .single();

      if (insertErr) {
        console.error('fss_departments insert error:', insertErr);
        throw new Error(`Failed to save department: ${insertErr.message}`);
      }
      department = inserted;
    }

    if (!department || !department.id) {
      throw new Error('Department record saved, but no generated ID was returned.');
    }

    return department;
  },

  /**
   * Loads all departments from fss_departments
   */
  async loadDepartmentsFromSupabase(): Promise<any[]> {
    if (!supabase) return [];
    try {
      const { data: depts, error: deptErr } = await supabase
        .from('fss_departments')
        .select('*')
        .order('id', { ascending: true });

      if (deptErr) {
        console.warn('Error fetching fss_departments:', deptErr.message);
        return [];
      }
      return depts || [];
    } catch (err) {
      console.error('Error in loadDepartmentsFromSupabase:', err);
      return [];
    }
  },

  /**
   * Deletes a department from fss_departments by id or department_name
   */
  async deleteDepartment(departmentIdOrName: string | number): Promise<boolean> {
    if (!supabase || !departmentIdOrName) return false;
    try {
      const numId = Number(departmentIdOrName);
      if (!isNaN(numId)) {
        const { error } = await supabase.from('fss_departments').delete().eq('id', numId);
        if (error) {
          console.error('Error deleting department from fss_departments by id:', error.message);
          return false;
        }
      } else {
        const { error } = await supabase.from('fss_departments').delete().eq('department_name', String(departmentIdOrName));
        if (error) {
          console.error('Error deleting department from fss_departments by name:', error.message);
          return false;
        }
      }
      return true;
    } catch (err) {
      console.error('Exception deleting department:', err);
      return false;
    }
  },

  /**
   * Syncs local departments into Supabase fss_departments if the remote table is empty
   */
  async syncLocalDepartmentsToSupabase(localDepartments: any[]): Promise<any[]> {
    if (!supabase) return [];
    const validDepts = (localDepartments || []).filter((d: any) => d.name || d.department_name);
    const syncedDepts: any[] = [];

    // Check existing departments to prevent duplicate insertion
    const { data: existing } = await supabase.from('fss_departments').select('id, department_name');
    const existingNames = new Set((existing || []).map((e: any) => (e.department_name || '').trim().toLowerCase()));

    for (const d of validDepts) {
      try {
        const name = (d.name || d.department_name || '').trim();
        if (existingNames.has(name.toLowerCase())) {
          const match = (existing || []).find((e: any) => (e.department_name || '').trim().toLowerCase() === name.toLowerCase());
          if (match) d.supabase_id = match.id;
          continue;
        }

        const res = await this.saveDepartment({
          department_name: name,
          manager: d.managerName || d.manager,
          manager_email: d.managerEmail || d.manager_email
        });

        if (res) {
          d.supabase_id = res.id;
          syncedDepts.push(res);
          existingNames.add(name.toLowerCase());
        }
      } catch (e) {
        console.warn('Failed to sync department to Supabase:', d.name, e);
      }
    }
    return syncedDepts;
  },

  /**
   * Saves or updates a bank account in fss_bank_accounts
   */
  async saveBankAccount(accountData: {
    supabase_id?: number | string | null;
    id?: number | string | null;
    account_name?: string;
    name?: string;
    account_type?: string | null;
    type?: string | null;
    account_number_masked?: string | null;
    number?: string | null;
    opening_balance?: number | string | null;
    openingBalance?: number | string | null;
    opening_balance_date?: string | null;
    openingBalanceDate?: string | null;
  }): Promise<any> {
    if (!supabase) {
      throw new Error('Supabase is not configured. Please check your .env configuration.');
    }

    const accName = (accountData.account_name || accountData.name || '').trim();
    if (!accName) {
      throw new Error('Account name is required.');
    }

    let accType = (accountData.account_type || accountData.type || 'Bank').trim();
    if (accType.toLowerCase() === 'bank') accType = 'Bank';
    else if (accType.toLowerCase() === 'cash') accType = 'Cash';
    else if (accType.toLowerCase() === 'fd' || accType.toLowerCase() === 'fixed deposit') accType = 'Fixed deposit';

    const openingBal = Number(accountData.opening_balance ?? accountData.openingBalance ?? 0);
    const openingDate = (accountData.opening_balance_date || accountData.openingBalanceDate || '2025-04-01').trim();

    const payload: any = {
      account_name: accName,
      account_type: accType,
      account_number_masked: (accountData.account_number_masked || accountData.number || '').trim() || null,
      opening_balance: !isNaN(openingBal) ? openingBal : 0,
      opening_balance_date: openingDate || '2025-04-01',
      updated_at: new Date().toISOString()
    };

    const existingId = accountData.supabase_id || (!isNaN(Number(accountData.id)) ? Number(accountData.id) : null);
    let bankAccount: any = null;

    // 1. Try update by numeric ID
    if (existingId) {
      const { data: updated, error: updateErr } = await supabase
        .from('fss_bank_accounts')
        .update(payload)
        .eq('id', existingId)
        .select()
        .single();

      if (!updateErr && updated) {
        bankAccount = updated;
      }
    }

    // 2. Try update by account_name
    if (!bankAccount && payload.account_name) {
      const { data: updatedByName, error: updateNameErr } = await supabase
        .from('fss_bank_accounts')
        .update(payload)
        .eq('account_name', payload.account_name)
        .select()
        .single();

      if (!updateNameErr && updatedByName) {
        bankAccount = updatedByName;
      }
    }

    // 3. Otherwise insert new bank account
    if (!bankAccount) {
      const { data: inserted, error: insertErr } = await supabase
        .from('fss_bank_accounts')
        .insert([payload])
        .select()
        .single();

      if (insertErr) {
        console.error('fss_bank_accounts insert error:', insertErr);
        throw new Error(`Failed to save bank account: ${insertErr.message}`);
      }
      bankAccount = inserted;
    }

    if (!bankAccount || !bankAccount.id) {
      throw new Error('Bank account record saved, but no generated ID was returned.');
    }

    return bankAccount;
  },

  /**
   * Loads all bank accounts from fss_bank_accounts
   */
  async loadBankAccountsFromSupabase(): Promise<any[]> {
    if (!supabase) return [];
    try {
      const { data: accounts, error: accErr } = await supabase
        .from('fss_bank_accounts')
        .select('*')
        .order('id', { ascending: true });

      if (accErr) {
        console.warn('Error fetching fss_bank_accounts:', accErr.message);
        return [];
      }
      return accounts || [];
    } catch (err) {
      console.error('Error in loadBankAccountsFromSupabase:', err);
      return [];
    }
  },

  /**
   * Deletes a bank account from fss_bank_accounts by id or account_name
   */
  async deleteBankAccount(accountIdOrName: string | number): Promise<boolean> {
    if (!supabase || !accountIdOrName) return false;
    try {
      const numId = Number(accountIdOrName);
      if (!isNaN(numId)) {
        const { error } = await supabase.from('fss_bank_accounts').delete().eq('id', numId);
        if (error) {
          console.error('Error deleting bank account from fss_bank_accounts by id:', error.message);
          return false;
        }
      } else {
        const { error } = await supabase.from('fss_bank_accounts').delete().eq('account_name', String(accountIdOrName));
        if (error) {
          console.error('Error deleting bank account from fss_bank_accounts by name:', error.message);
          return false;
        }
      }
      return true;
    } catch (err) {
      console.error('Exception deleting bank account:', err);
      return false;
    }
  },

  /**
   * Syncs local bank accounts into Supabase fss_bank_accounts if the remote table is empty
   */
  async syncLocalBankAccountsToSupabase(localAccounts: any[]): Promise<any[]> {
    if (!supabase) return [];
    const validAccounts = (localAccounts || []).filter((a: any) => a.name || a.account_name);
    const syncedAccounts: any[] = [];

    // Check existing bank accounts to prevent duplicate insertion
    const { data: existing } = await supabase.from('fss_bank_accounts').select('id, account_name');
    const existingNames = new Set((existing || []).map((e: any) => (e.account_name || '').trim().toLowerCase()));

    for (const a of validAccounts) {
      try {
        const name = (a.name || a.account_name || '').trim();
        if (existingNames.has(name.toLowerCase())) {
          const match = (existing || []).find((e: any) => (e.account_name || '').trim().toLowerCase() === name.toLowerCase());
          if (match) a.supabase_id = match.id;
          continue;
        }

        const res = await this.saveBankAccount({
          account_name: name,
          account_type: a.type,
          account_number_masked: a.number || a.account_number_masked,
          opening_balance: a.openingBalance ?? a.opening_balance ?? 0,
          opening_balance_date: a.openingBalanceDate || a.opening_balance_date || '2025-04-01'
        });

        if (res) {
          a.supabase_id = res.id;
          syncedAccounts.push(res);
          existingNames.add(name.toLowerCase());
        }
      } catch (e) {
        console.warn('Failed to sync bank account to Supabase:', a.name, e);
      }
    }
    return syncedAccounts;
  },

  /**
   * Loads all category lookup tables from Supabase (with in-memory caching and fallbacks)
   */
  async loadCategoryLookups(forceRefresh = false): Promise<{
    types: any[];
    summaryBuckets: any[];
    groups: any[];
    linkedTo: any[];
    natures: any[];
    tdsSections: any[];
    inputGstOnBills?: any[];
  }> {
    if (!forceRefresh && _categoryLookupsCache) {
      return _categoryLookupsCache;
    }

    const defaultLookups = {
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
        { id: 1, value: 'claimable_itc', label: 'Claimable (ITC)', description: 'Input GST eligible for input tax credit, subject to applicable rules.', is_active: true },
        { id: 2, value: 'blocked_not_claimable', label: 'Blocked · not claimable', description: 'Input GST that is blocked or not eligible for input tax credit.', is_active: true }
      ]
    };

    const exposeWindowLookups = (cache: any) => {
      if (typeof window !== 'undefined' && cache) {
        (window as any).__categoryLookups = cache;
        (window as any).__categoryTypeList = cache.types || [];
        (window as any).__categorySummaryBucketList = cache.summaryBuckets || [];
        (window as any).__categoryGroupList = (cache.groups || []).map((g: any) => g.name);
        (window as any).__categoryLinkedToList = cache.linkedTo || [];
        (window as any).__categoryNatureList = cache.natures || [];
        (window as any).__categoryTdsSectionList = cache.tdsSections || [];
        (window as any).__categoryInputGstOnBillsList = cache.inputGstOnBills || [];
      }
    };

    if (!supabase) {
      _categoryLookupsCache = defaultLookups;
      exposeWindowLookups(defaultLookups);
      return defaultLookups;
    }

    try {
      const [tyRes, bRes, gRes, lRes, nRes, tRes, gstRes] = await Promise.all([
        supabase.from('fss_type').select('*').order('id', { ascending: true }),
        supabase.from('fss_category_summary_bucket').select('*').order('id', { ascending: true }),
        supabase.from('fss_category_group').select('*').order('id', { ascending: true }),
        supabase.from('fss_category_linked_to').select('*').order('id', { ascending: true }),
        supabase.from('fss_category_nature').select('*').order('id', { ascending: true }),
        supabase.from('fss_category_tds_section').select('*').order('id', { ascending: true }),
        supabase.from('fss_category_input_gst_on_bills').select('*').order('id', { ascending: true })
      ]);

      _categoryLookupsCache = {
        types: tyRes.data?.length ? tyRes.data : defaultLookups.types,
        summaryBuckets: bRes.data?.length ? bRes.data : defaultLookups.summaryBuckets,
        groups: gRes.data?.length ? gRes.data : defaultLookups.groups,
        linkedTo: lRes.data?.length ? lRes.data : defaultLookups.linkedTo,
        natures: nRes.data?.length ? nRes.data : defaultLookups.natures,
        tdsSections: tRes.data?.length ? tRes.data : defaultLookups.tdsSections,
        inputGstOnBills: gstRes.data?.length ? gstRes.data : defaultLookups.inputGstOnBills
      };

      exposeWindowLookups(_categoryLookupsCache);

      return _categoryLookupsCache;
    } catch (err) {
      console.error('Error loading category lookups:', err);
      _categoryLookupsCache = defaultLookups;
      exposeWindowLookups(defaultLookups);
      return defaultLookups;
    }
  },

  /**
   * Helper to resolve category foreign key references into Supabase column values
   */
  resolveCategoryPayload(catData: any, lookups: any): any {
    const catName = (catData.category_name || catData.name || '').trim();
    if (!catName) {
      throw new Error('Category name is required.');
    }

    const norm = (s: string) => (s || '').toLowerCase().replace(/[\u2013\u2014\-]/g, '-').trim();

    // 1. Resolve type_id (1: Select, 2: Outflow, 3: Inflow)
    let typeId: number | null = catData.type_id || null;
    if (!typeId) {
      const typeStr = (catData.type || 'outflow').trim().toLowerCase();
      if (typeStr === 'select') {
        throw new Error('Please select a valid Category Type.');
      }
      const matchedType = lookups.types.find((t: any) =>
        t.name.toLowerCase() === typeStr ||
        (typeStr === 'outflow' && t.name.toLowerCase().includes('outflow')) ||
        (typeStr === 'inflow' && t.name.toLowerCase().includes('inflow'))
      );
      if (matchedType) typeId = matchedType.id;
      else typeId = typeStr === 'inflow' ? 3 : 2;
    }
    if (typeId === 1) {
      throw new Error('Please select a valid Category Type.');
    }

    // 2. Resolve summary_bucket_id
    let bucketId: number | null = catData.summary_bucket_id || null;
    const rawBucket = (catData.summary_bucket || catData.bucket || '').trim().toLowerCase();
    if (!bucketId && rawBucket) {
      const matchedB = lookups.summaryBuckets.find((b: any) => {
        const bn = b.name.toLowerCase();
        return bn === rawBucket ||
          bn.includes(rawBucket) ||
          (rawBucket === 'op_cost' && bn.includes('operating costs')) ||
          (rawBucket === 'proj_cost' && bn.includes('project costs')) ||
          (rawBucket === 'tax' && bn.includes('tax & statutory')) ||
          (rawBucket === 'capex' && bn.includes('capex')) ||
          (rawBucket === 'fin_out' && bn.includes('financing & owner')) ||
          (rawBucket === 'op_rec' && bn.includes('operating receipts')) ||
          (rawBucket === 'oth_inc' && bn.includes('other income')) ||
          (rawBucket === 'fin_in' && bn.includes('financing (inflow)'));
      });
      if (matchedB) bucketId = matchedB.id;
    }

    // If still no bucketId, derive from group/kind/type
    if (!bucketId) {
      const typeStr = (catData.type || (typeId === 3 ? 'inflow' : 'outflow')).trim().toLowerCase();
      const kindStr = (catData.nature || catData.kind || 'operating').trim().toLowerCase();
      const groupStr = (catData.group || '').trim().toLowerCase();
      let derivedKey = 'op_cost';
      if (typeStr === 'inflow') {
        derivedKey = (kindStr === 'financing' || kindStr.includes('financing')) ? 'fin_in' : (groupStr === 'other income' ? 'oth_inc' : 'op_rec');
      } else {
        if (groupStr === 'project costs') derivedKey = 'proj_cost';
        else if (kindStr === 'tax' || kindStr.includes('statutory')) derivedKey = 'tax';
        else if (kindStr === 'capex') derivedKey = 'capex';
        else if (kindStr === 'financing' || kindStr.includes('owner')) derivedKey = 'fin_out';
        else derivedKey = 'op_cost';
      }
      const matchedB = lookups.summaryBuckets.find((b: any) => {
        const bn = b.name.toLowerCase();
        return (derivedKey === 'op_cost' && bn.includes('operating costs')) ||
          (derivedKey === 'proj_cost' && bn.includes('project costs')) ||
          (derivedKey === 'tax' && bn.includes('tax & statutory')) ||
          (derivedKey === 'capex' && bn.includes('capex')) ||
          (derivedKey === 'fin_out' && bn.includes('financing & owner')) ||
          (derivedKey === 'op_rec' && bn.includes('operating receipts')) ||
          (derivedKey === 'oth_inc' && bn.includes('other income')) ||
          (derivedKey === 'fin_in' && bn.includes('financing (inflow)'));
      });
      if (matchedB) bucketId = matchedB.id;
    }

    // 3. Resolve group_id
    let groupId: number | null = catData.group_id || null;
    const groupName = (catData.group || '').trim();
    if (!groupId && groupName) {
      const matchedG = lookups.groups.find((g: any) => norm(g.name) === norm(groupName));
      if (matchedG) {
        groupId = matchedG.id;
      }
    }

    // 4. Resolve linked_to_id
    let linkedToId: number | null = catData.linked_to_id || null;
    if (!linkedToId) {
      const partyKind = (catData.linked_to || catData.partyKind || 'vendor').trim().toLowerCase();
      const matchedL = lookups.linkedTo.find((l: any) => {
        const ln = l.name.toLowerCase();
        return ln === partyKind ||
          (partyKind === 'client' && ln === 'client') ||
          (partyKind === 'vendor' && ln === 'vendor') ||
          (partyKind === 'employee' && ln === 'employee') ||
          (partyKind === 'other' && ln === 'other');
      });
      if (matchedL) linkedToId = matchedL.id;
      else linkedToId = 2; // fallback to Vendor
    }

    // 5. Resolve nature_id
    let natureId: number | null = catData.nature_id || null;
    if (!natureId) {
      const kindStr = (catData.nature || catData.kind || 'operating').trim().toLowerCase();
      const matchedN = lookups.natures.find((n: any) => {
        const nn = n.name.toLowerCase();
        return nn === kindStr ||
          (kindStr === 'operating' && nn.includes('operating')) ||
          ((kindStr === 'tax' || kindStr.includes('statutory')) && nn.includes('statutory')) ||
          (kindStr === 'capex' && nn.includes('capex')) ||
          ((kindStr === 'financing' || kindStr.includes('owner')) && nn.includes('financing'));
      });
      if (matchedN) natureId = matchedN.id;
      else natureId = 1; // fallback to Operating
    }

    // 6. Resolve tds_section_id
    let tdsSectionId: number | null = catData.tds_section_id || null;
    if (!tdsSectionId) {
      const tdsCode = (catData.tds_section || catData.tdsSection || '').trim().toUpperCase();
      if (tdsCode) {
        const matchedT = lookups.tdsSections.find((t: any) =>
          t.code.toUpperCase() === tdsCode || tdsCode.includes(t.code.toUpperCase())
        );
        if (matchedT) tdsSectionId = matchedT.id;
      }
    }

    // 7. Input GST on bills
    let inputGst = catData.input_gst_on_bills;
    if (!inputGst) {
      const isBlocked = (catData.itcBlocked === true || catData.itcBlocked === '1' || catData.itcBlocked === 'true' || catData.itcBlocked === 'blocked_not_claimable');
      const matchedGst = (lookups.inputGstOnBills || []).find((g: any) =>
        isBlocked ? (g.value === 'blocked_not_claimable' || (g.label || '').toLowerCase().includes('blocked')) : (g.value === 'claimable_itc' || (g.label || '').toLowerCase().includes('claimable'))
      );
      inputGst = matchedGst ? matchedGst.label : (isBlocked ? 'Blocked · not claimable' : 'Claimable (ITC)');
    } else {
      const matchedGst = (lookups.inputGstOnBills || []).find((g: any) =>
        g.value === inputGst || g.label === inputGst
      );
      if (matchedGst) inputGst = matchedGst.label;
    }

    return {
      category_name: catName,
      type_id: typeId,
      summary_bucket_id: bucketId,
      group_id: groupId,
      linked_to_id: linkedToId,
      nature_id: natureId,
      tds_section_id: tdsSectionId,
      sac_code: (catData.sac_code || catData.sac || '').trim() || null,
      input_gst_on_bills: inputGst
    };
  },

  /**
   * Saves or updates a category in fss_categories
   */
  async saveCategory(catData: {
    supabase_id?: number | string | null;
    id?: number | string | null;
    category_name?: string;
    name?: string;
    type?: string | null;
    type_id?: number | null;
    summary_bucket?: string | null;
    summary_bucket_id?: number | null;
    bucket?: string | null;
    group?: string | null;
    group_id?: number | null;
    linked_to?: string | null;
    linked_to_id?: number | null;
    partyKind?: string | null;
    nature?: string | null;
    nature_id?: number | null;
    kind?: string | null;
    tds_section?: string | null;
    tds_section_id?: number | null;
    tdsSection?: string | null;
    sac_code?: string | null;
    sac?: string | null;
    input_gst_on_bills?: string | null;
    itcBlocked?: boolean | string | null;
  }): Promise<any> {
    if (!supabase) {
      throw new Error('Supabase is not configured. Please check your .env configuration.');
    }

    const lookups = await this.loadCategoryLookups();
    const payload = this.resolveCategoryPayload(catData, lookups);

    // If group_id is still null and a group name was provided, create new group
    const groupName = (catData.group || '').trim();
    if (!payload.group_id && groupName) {
      try {
        const { data: newG } = await supabase.from('fss_category_group').insert([{ name: groupName }]).select().single();
        if (newG) {
          payload.group_id = newG.id;
          lookups.groups.push(newG);
        }
      } catch (e) {
        console.warn('Could not insert new category group:', groupName, e);
      }
    }

    const existingId = catData.supabase_id || (!isNaN(Number(catData.id)) ? Number(catData.id) : null);
    let category: any = null;

    // 1. Try update by numeric ID if provided
    if (existingId) {
      const { data: updated, error: updateErr } = await supabase
        .from('fss_categories')
        .update(payload)
        .eq('id', existingId)
        .select('*, fss_type(name), fss_category_summary_bucket(name), fss_category_group(name), fss_category_linked_to(name), fss_category_nature(name), fss_category_tds_section(code, description)')
        .maybeSingle();

      if (!updateErr && updated) {
        category = updated;
      }
    }

    // 2. Check if already exists by category_name
    if (!category && payload.category_name) {
      const { data: existingRow } = await supabase
        .from('fss_categories')
        .select('id')
        .eq('category_name', payload.category_name)
        .maybeSingle();

      if (existingRow?.id) {
        const { data: updatedByName, error: updateNameErr } = await supabase
          .from('fss_categories')
          .update(payload)
          .eq('id', existingRow.id)
          .select('*, fss_type(name), fss_category_summary_bucket(name), fss_category_group(name), fss_category_linked_to(name), fss_category_nature(name), fss_category_tds_section(code, description)')
          .maybeSingle();

        if (!updateNameErr && updatedByName) {
          category = updatedByName;
        }
      }
    }

    // 3. Otherwise insert new category
    if (!category) {
      const { data: inserted, error: insertErr } = await supabase
        .from('fss_categories')
        .insert([payload])
        .select('*, fss_type(name), fss_category_summary_bucket(name), fss_category_group(name), fss_category_linked_to(name), fss_category_nature(name), fss_category_tds_section(code, description)')
        .single();

      if (insertErr) {
        console.error('fss_categories insert error:', insertErr);
        throw new Error(`Failed to save category: ${insertErr.message}`);
      }
      category = inserted;
    }

    if (!category || !category.id) {
      throw new Error('Category record saved, but no generated ID was returned.');
    }

    return category;
  },

  /**
   * Loads all categories from fss_categories with lookup joins
   */
  async loadCategoriesFromSupabase(): Promise<any[]> {
    if (!supabase) return [];
    try {
      const { data: cats, error: catErr } = await supabase
        .from('fss_categories')
        .select('*, fss_type(name), fss_category_summary_bucket(name), fss_category_group(name), fss_category_linked_to(name), fss_category_nature(name), fss_category_tds_section(code, description)')
        .order('id', { ascending: true });

      if (catErr) {
        console.warn('Error fetching fss_categories:', catErr.message);
        return [];
      }
      return cats || [];
    } catch (err) {
      console.error('Error in loadCategoriesFromSupabase:', err);
      return [];
    }
  },

  /**
   * Deletes a category from fss_categories by id or category_name
   */
  async deleteCategory(categoryIdOrName: string | number): Promise<boolean> {
    if (!supabase || !categoryIdOrName) return false;
    try {
      const numId = Number(categoryIdOrName);
      if (!isNaN(numId)) {
        const { error } = await supabase.from('fss_categories').delete().eq('id', numId);
        if (error) {
          console.error('Error deleting category from fss_categories by id:', error.message);
          return false;
        }
      } else {
        const { error } = await supabase.from('fss_categories').delete().eq('category_name', String(categoryIdOrName));
        if (error) {
          console.error('Error deleting category from fss_categories by name:', error.message);
          return false;
        }
      }
      return true;
    } catch (err) {
      console.error('Exception deleting category:', err);
      return false;
    }
  },

  /**
   * Syncs local categories into Supabase fss_categories if the remote table is empty or missing them
   */
  async syncLocalCategoriesToSupabase(localCategories: any[]): Promise<any[]> {
    if (!supabase) return [];
    const validCats = (localCategories || []).filter((c: any) => c.name || c.category_name);
    if (validCats.length === 0) return [];

    const lookups = await this.loadCategoryLookups();

    // Check existing categories to prevent duplicate insertion
    const { data: existing } = await supabase.from('fss_categories').select('id, category_name');
    const existingMap = new Map<string, number>();
    (existing || []).forEach((e: any) => {
      const k = (e.category_name || '').trim().toLowerCase();
      if (k) existingMap.set(k, e.id);
    });

    const toInsertPayloads: any[] = [];
    const toInsertRefs: any[] = [];
    const syncedCats: any[] = [];

    for (const c of validCats) {
      const name = (c.name || c.category_name || '').trim();
      if (!name) continue;
      const lower = name.toLowerCase();

      if (existingMap.has(lower)) {
        c.supabase_id = existingMap.get(lower);
        continue;
      }

      try {
        const payload = this.resolveCategoryPayload(c, lookups);

        // If group is new, create it in fss_category_group
        if (!payload.group_id && c.group) {
          const { data: newG } = await supabase.from('fss_category_group').insert([{ name: c.group.trim() }]).select().single();
          if (newG) {
            payload.group_id = newG.id;
            lookups.groups.push(newG);
          }
        }

        toInsertPayloads.push(payload);
        toInsertRefs.push(c);
      } catch (e) {
        console.warn('Could not prepare category payload for sync:', name, e);
      }
    }

    if (toInsertPayloads.length > 0) {
      try {
        const { data: inserted, error: insertErr } = await supabase
          .from('fss_categories')
          .insert(toInsertPayloads)
          .select('*, fss_type(name), fss_category_summary_bucket(name), fss_category_group(name), fss_category_linked_to(name), fss_category_nature(name), fss_category_tds_section(code, description)');

        if (insertErr) {
          console.error('Batch insert into fss_categories error:', insertErr);
        } else if (inserted) {
          inserted.forEach((ins: any, idx: number) => {
            if (toInsertRefs[idx]) {
              toInsertRefs[idx].supabase_id = ins.id;
            }
            syncedCats.push(ins);
          });
        }
      } catch (batchErr) {
        console.error('Exception during batch category sync:', batchErr);
      }
    }

    return syncedCats;
  },

  /**
   * Saves an order and its associated departments, payment terms, and details into Supabase tables:
   * - public.fss_table_order_po
   * - public.fss_table_order_departments
   * - public.fss_table_order_payment_terms
   * - public.fss_table_order_details
   */
  async saveOrder(
    orderData: any,
    partiesListArg: any[] = [],
    projectsListArg: any[] = [],
    departmentsListArg: any[] = []
  ): Promise<any> {
    if (!supabase) return null;
    const isUUID = (s: any) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));

    const orderNumber = String(orderData.orderNo || orderData.order_number || orderData.po_number || '').trim();
    if (!orderNumber) {
      throw new Error('PO / Order number is required.');
    }

    // 1. Order Date
    const orderDate = orderData.date || orderData.order_date || new Date().toISOString().slice(0, 10);
    const expComp = (orderData.expectedCompletion || orderData.expected_completion || '').trim();
    const expectedCompletion = expComp ? expComp : null;

    // 2. Client & Project resolving
    const partiesList = (partiesListArg && partiesListArg.length > 0)
      ? partiesListArg
      : (typeof window !== 'undefined' && ((window as any).Store?.data?.parties || (window as any).IuovaCore?.Store?.data?.parties || (window as any).api?.list?.('parties') || (window as any).IuovaCore?.api?.list?.('parties'))) || [];

    const projectsList = (projectsListArg && projectsListArg.length > 0)
      ? projectsListArg
      : (typeof window !== 'undefined' && ((window as any).Store?.data?.projects || (window as any).IuovaCore?.Store?.data?.projects || (window as any).api?.list?.('projects') || (window as any).IuovaCore?.api?.list?.('projects'))) || [];

    const deptList = (departmentsListArg && departmentsListArg.length > 0)
      ? departmentsListArg
      : (typeof window !== 'undefined' && ((window as any).Store?.data?.departments || (window as any).IuovaCore?.Store?.data?.departments || (window as any).api?.list?.('departments') || (window as any).IuovaCore?.api?.list?.('departments'))) || [];

    let clientId: string | null = null;
    let clientName: string = String(orderData.client_name || orderData.clientName || '').trim();
    if (clientName.toLowerCase() === 'client') clientName = '';

    if (orderData.clientId) {
      if (isUUID(orderData.clientId)) {
        clientId = orderData.clientId;
      }
      const cl = partiesList.find((p: any) => p.id === orderData.clientId || p.supabase_id === orderData.clientId);
      if (cl) {
        if (!clientName) clientName = String(cl.name || cl.client_name || '').trim();
        if (!clientId && cl.supabase_id && isUUID(cl.supabase_id)) {
          clientId = cl.supabase_id;
        } else if (!clientId && cl.id && isUUID(cl.id)) {
          clientId = cl.id;
        }
      }
    }
    if (!clientName && clientId) {
      const cl = partiesList.find((p: any) => p.supabase_id === clientId || p.id === clientId);
      if (cl) clientName = String(cl.name || cl.client_name || '').trim();
    }

    // Fallback direct Supabase lookup if clientName is still empty
    if (!clientName && (clientId || orderData.clientId)) {
      try {
        const targetId = clientId || (isUUID(orderData.clientId) ? orderData.clientId : null);
        if (targetId) {
          const { data: cRow } = await supabase.from('fss_client').select('id, client_name').eq('id', targetId).maybeSingle();
          if (cRow?.client_name) {
            clientName = cRow.client_name;
          }
        }
      } catch (err) {
        console.warn('Could not fetch client from fss_client:', err);
      }
    }

    // If clientName is known but clientId is missing, look up fss_client by name
    if (!clientId && clientName) {
      try {
        const { data: cRow } = await supabase.from('fss_client').select('id').ilike('client_name', clientName).limit(1).maybeSingle();
        if (cRow?.id) {
          clientId = cRow.id;
        }
      } catch (_) {}
    }

    if (!clientName) {
      clientName = 'Client';
    }

    let projectId: string | null = null;
    let projectName: string = String(orderData.project_name || orderData.projectName || '').trim();
    if (projectName.toLowerCase() === 'project') projectName = '';

    if (orderData.projectId) {
      if (isUUID(orderData.projectId)) {
        projectId = orderData.projectId;
      }
      const pr = projectsList.find((p: any) => 
        p.id === orderData.projectId || 
        p.supabase_id === orderData.projectId || 
        String(p.id) === String(orderData.projectId) ||
        (p.code && p.code.toLowerCase() === String(orderData.projectId).toLowerCase())
      );
      if (pr) {
        if (!projectName) {
          projectName = pr.name || pr.project_name || (pr.code ? (pr.code + ' · ' + (pr.name || '')) : pr.code) || '';
        }
        if (!projectId && pr.supabase_id && isUUID(pr.supabase_id)) {
          projectId = pr.supabase_id;
        } else if (!projectId && pr.id && isUUID(pr.id)) {
          projectId = pr.id;
        }
      }
    }

    // Fallback direct Supabase lookup if projectName is still empty
    if (!projectName && orderData.projectId) {
      try {
        let pQuery = supabase.from('fss_projects').select('id, project_name, project_code');
        if (!isNaN(Number(orderData.projectId))) {
          pQuery = pQuery.eq('id', Number(orderData.projectId));
        } else if (typeof orderData.projectId === 'string') {
          pQuery = pQuery.or(`project_code.ilike.%${orderData.projectId}%,project_name.ilike.%${orderData.projectId}%`);
        }
        const { data: pRow } = await pQuery.limit(1).maybeSingle();
        if (pRow) {
          projectName = pRow.project_name || pRow.project_code || '';
        }
      } catch (err) {
        console.warn('Could not fetch project from fss_projects:', err);
      }
    }

    if (!projectName) {
      projectName = 'Project';
    }

    // 3. GST values
    const gstRate = Math.min(100, Math.max(0, Number(orderData.gstRate ?? orderData.gst_rate ?? 18)));
    let gstType = 'CGST + SGST';
    const rawGstType = String(orderData.gstType || orderData.gst_type || '').toLowerCase();
    if (rawGstType === 'inter' || rawGstType === 'igst') gstType = 'IGST';
    else if (rawGstType === 'none' || gstRate === 0) gstType = 'NONE';
    else gstType = 'CGST + SGST';

    const preGstAmount = Math.max(0, Number(orderData.taxable ?? orderData.pre_gst_amount ?? orderData.order_value_pre_gst ?? 0));
    const gstAmount = Math.max(0, Number(orderData.gstAmount ?? orderData.gst_amount ?? (preGstAmount * gstRate / 100)));
    const totalAmount = Math.max(0, Number(orderData.total ?? orderData.total_amount ?? orderData.order_total_incl_gst ?? (preGstAmount + gstAmount)));

    // 4. Save into public.fss_table_order_po
    const poPayload: any = {
      po_number: orderNumber,
      order_date: orderDate,
      client_id: clientId,
      client_name: clientName,
      project_id: projectId,
      project_name: projectName,
      updated_at: new Date().toISOString()
    };

    if (orderData.supabase_id && isUUID(orderData.supabase_id)) {
      poPayload.id = orderData.supabase_id;
    }

    const { data: savedPo, error: poErr } = await supabase
      .from('fss_table_order_po')
      .upsert(poPayload, { onConflict: 'po_number' })
      .select()
      .single();

    if (poErr) {
      console.error('Error saving order into fss_table_order_po:', poErr);
      throw new Error(`Failed to save PO to Supabase: ${poErr.message}`);
    }

    const orderPoId = savedPo.id;

    // 5. Save into public.fss_table_order_departments
    try {
      await supabase.from('fss_table_order_departments').delete().eq('order_po_id', orderPoId);

      const deptRows: any[] = [];

      if (Array.isArray(orderData.split) && orderData.split.length > 0) {
        orderData.split.forEach((s: any) => {
          if (!s.departmentId && !s.department_name && !s.departmentName) return;
          const dp = deptList.find((d: any) => d.id === s.departmentId);
          const dName = dp?.name || s.department_name || s.departmentName || s.departmentId || 'Operations / Admin';
          const amt = Math.max(0, Number(s.amount != null && s.amount !== '' ? s.amount : (preGstAmount * (s.pct || 100) / 100)));
          deptRows.push({
            order_po_id: orderPoId,
            po_number: orderNumber,
            client_name: clientName,
            department_name: dName,
            amount: amt,
            order_value_pre_gst: preGstAmount,
            gst_rate: gstRate,
            gst_type: gstType,
            order_total_incl_gst: totalAmount,
            updated_at: new Date().toISOString()
          });
        });
      }

      if (deptRows.length === 0) {
        const dp = deptList.find((d: any) => d.id === orderData.departmentId);
        const dName = dp?.name || orderData.department_name || orderData.departmentId || 'Operations / Admin';
        deptRows.push({
          order_po_id: orderPoId,
          po_number: orderNumber,
          client_name: clientName,
          department_name: dName,
          amount: preGstAmount,
          order_value_pre_gst: preGstAmount,
          gst_rate: gstRate,
          gst_type: gstType,
          order_total_incl_gst: totalAmount,
          updated_at: new Date().toISOString()
        });
      }

      if (deptRows.length > 0) {
        await supabase.from('fss_table_order_departments').insert(deptRows);
      }
    } catch (dErr) {
      console.warn('Error syncing order departments:', dErr);
    }

    // 6. Save into public.fss_table_order_payment_terms
    try {
      await supabase.from('fss_table_order_payment_terms').delete().eq('order_po_id', orderPoId);

      const termsRows: any[] = [];
      const rawTerms = Array.isArray(orderData.terms) && orderData.terms.length > 0
        ? orderData.terms
        : [{ label: '100% on delivery', pct: 100 }];

      rawTerms.forEach((t: any, idx: number) => {
        const pct = Math.min(100, Math.max(0, Number(t.pct || t.percentage || 0)));
        const amt = Math.max(0, Number(t.amount != null && t.amount !== '' ? t.amount : Math.round(preGstAmount * pct / 100)));
        const isLast = idx === rawTerms.length - 1;
        const isBalance = Boolean(t.is_balance ?? (isLast && rawTerms.length > 1));
        termsRows.push({
          order_po_id: orderPoId,
          po_number: orderNumber,
          client_name: clientName,
          milestone_name: String(t.label || t.milestone_name || `Milestone ${idx + 1}`).trim(),
          milestone_amount: amt,
          percentage: pct,
          sequence_number: idx + 1,
          is_balance: isBalance,
          updated_at: new Date().toISOString()
        });
      });

      if (termsRows.length > 0) {
        await supabase.from('fss_table_order_payment_terms').insert(termsRows);
      }
    } catch (mErr) {
      console.warn('Error syncing order payment terms:', mErr);
    }

    // 7. Save into public.fss_table_order_details
    try {
      const att = Array.isArray(orderData.attachments) && orderData.attachments.length > 0 ? orderData.attachments[0] : null;
      const docName = att?.name || att?.file_name || orderData.document_name || null;
      const docPath = att?.path || att?.storage_path || orderData.document_path || null;
      const docUrl = att?.url || orderData.document_url || null;

      const detailsPayload: any = {
        order_po_id: orderPoId,
        po_number: orderNumber,
        client_name: clientName,
        scope: (orderData.scope && String(orderData.scope).trim()) || null,
        expected_completion: expectedCompletion,
        client_contact: (orderData.contact || orderData.client_contact || '').trim() || null,
        notes: (orderData.notes && String(orderData.notes).trim()) || null,
        document_name: docName,
        document_path: docPath,
        document_url: docUrl,
        updated_at: new Date().toISOString()
      };

      await supabase
        .from('fss_table_order_details')
        .upsert(detailsPayload, { onConflict: 'order_po_id' });
    } catch (detErr) {
      console.warn('Error syncing order details:', detErr);
    }

    // Return joined order
    const { data: fullOrder } = await supabase
      .from('fss_table_order_po')
      .select(`
        *,
        fss_table_order_departments(*),
        fss_table_order_payment_terms(*),
        fss_table_order_details(*)
      `)
      .eq('id', orderPoId)
      .single();

    return fullOrder || savedPo;
  },

  /**
   * Loads all orders with departments, payment terms, and details from Supabase
   */
  async loadOrdersFromSupabase(): Promise<any[]> {
    if (!supabase) return [];
    try {
      const { data, error } = await supabase
        .from('fss_table_order_po')
        .select(`
          *,
          fss_table_order_departments(*),
          fss_table_order_payment_terms(*),
          fss_table_order_details(*)
        `)
        .order('order_date', { ascending: false });

      if (error) {
        console.warn('Error fetching orders from fss_table_order_po:', error.message);
        // Fallback to fss_table_orders if needed
        const { data: legacyData } = await supabase
          .from('fss_table_orders')
          .select(`*, fss_table_order_departments(*), fss_table_order_milestones(*), fss_table_order_documents(*)`)
          .order('order_date', { ascending: false });
        return legacyData || [];
      }
      return data || [];
    } catch (err) {
      console.error('Unexpected error loading orders:', err);
      return [];
    }
  },

  /**
   * Deletes an order from fss_table_order_po (cascades to departments, payment terms, details)
   */
  async deleteOrder(orderIdOrNo: string | number): Promise<boolean> {
    if (!supabase) return false;
    try {
      const idStr = String(orderIdOrNo);
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idStr);
      let query = supabase.from('fss_table_order_po').delete();
      if (isUUID) {
        query = query.eq('id', idStr);
      } else {
        query = query.eq('po_number', idStr);
      }
      const { error } = await query;
      if (error) {
        console.error('Error deleting order from fss_table_order_po:', error);
      }

      // Also attempt cleanup on legacy fss_table_orders
      try {
        const q2 = supabase.from('fss_table_orders').delete();
        if (isUUID) await q2.eq('id', idStr);
        else await q2.eq('order_number', idStr);
      } catch (_) {}

      return true;
    } catch (err) {
      console.error('Exception deleting order from Supabase:', err);
      return false;
    }
  },

  /**
   * Batch syncs initial local orders into Supabase if fss_table_order_po is empty
   */
  async syncLocalOrdersToSupabase(
    localOrders: any[],
    partiesList: any[] = [],
    projectsList: any[] = [],
    departmentsList: any[] = []
  ): Promise<any[]> {
    if (!supabase) return [];
    const valid = (localOrders || []).filter((o: any) => o.orderNo || o.order_number || o.po_number);
    if (valid.length === 0) return [];

    const synced: any[] = [];
    for (const o of valid) {
      try {
        const res = await this.saveOrder(o, partiesList, projectsList, departmentsList);
        if (res) {
          o.supabase_id = res.id;
          synced.push(res);
        }
      } catch (err) {
        console.warn('Could not sync initial order:', o.orderNo || o.po_number, err);
      }
    }
    return synced;
  },

  /**
   * Formats a local entry / transaction into the schema expected by public.fss_table_transactions
   */
  formatTransactionPayload(
    entry: any,
    parties: any[] = [],
    projects: any[] = [],
    departments: any[] = [],
    categories: any[] = [],
    accounts: any[] = []
  ) {
    const isOutflow = entry.type === 'outflow';
    const txnType = entry.type === 'inflow' ? 'Inflow' : 'Outflow';
    const txnDate = entry.date || entry.transaction_date || new Date().toISOString().split('T')[0];

    // Resolve Category name
    let categoryName = entry.category || entry.categoryName || '';
    if (!categoryName && entry.categoryId) {
      const matchCat = categories.find((c: any) => c.id === entry.categoryId || c.supabase_id === entry.categoryId);
      if (matchCat) categoryName = matchCat.name;
    }
    if (!categoryName) {
      categoryName = txnType === 'Inflow' ? 'Operating Receipts' : 'Office – Fixed';
    }

    // Resolve Description (NOT NULL)
    const rawDesc = (entry.description || '').trim();
    const description = rawDesc || categoryName || entry.refNo || 'Transaction';

    // Resolve Reference number
    const referenceNumber = entry.refNo || entry.txnRef || entry.reference_number || null;

    // Resolve Party name
    let partyName = entry.party_name || entry.partyName || '';
    if (!partyName && entry.partyId) {
      const matchParty = parties.find((p: any) => p.id === entry.partyId || p.supabase_id === entry.partyId);
      if (matchParty) partyName = matchParty.name;
    }

    // Resolve Project
    let projectName = entry.project_name || entry.projectName || '';
    let projectCode = entry.project_code || entry.projectCode || '';
    if ((!projectName || !projectCode) && entry.projectId) {
      const matchProj = projects.find((p: any) => p.id === entry.projectId || p.supabase_id === entry.projectId);
      if (matchProj) {
        if (!projectName) projectName = matchProj.name;
        if (!projectCode) projectCode = matchProj.code;
      }
    }

    // Resolve Department
    let departmentName = entry.department || entry.departmentName || '';
    if (!departmentName && entry.departmentId) {
      const matchDept = departments.find((d: any) => d.id === entry.departmentId || d.supabase_id === entry.departmentId);
      if (matchDept) departmentName = matchDept.name;
    }

    // Resolve Account name
    let accountName = entry.account_name || entry.accountName || '';
    if (!accountName && entry.accountId) {
      const matchAcc = accounts.find((a: any) => a.id === entry.accountId || a.supabase_id === entry.accountId);
      if (matchAcc) accountName = matchAcc.name;
    }

    // Amounts
    const taxableAmount = Math.max(0, Number(entry.taxable ?? entry.taxable_amount) || 0);
    const gstRate = Math.max(0, Math.min(100, Number(entry.gstRate ?? entry.gst_rate) || 0));
    const gstAmount = Math.max(0, Number(entry.gstAmount ?? entry.gst_amount) || 0);
    const tdsAmount = Math.max(0, Number(entry.tdsAmount ?? entry.tds_amount) || 0);

    // Net cash: inflow positive, outflow negative
    let netAmount = Math.abs(Number(entry.amount) || (taxableAmount + gstAmount - tdsAmount));
    if (netAmount === 0 && Number(entry.net_cash)) {
      netAmount = Math.abs(Number(entry.net_cash));
    }
    const netCash = isOutflow ? -netAmount : netAmount;

    // Financial year
    const financialYear = entry.financial_year || getFinancialYear(txnDate);

    // Status: Active or Cancelled
    const status = entry.deleted ? 'Cancelled' : (entry.status === 'Cancelled' ? 'Cancelled' : 'Active');

    return {
      transaction_date: txnDate,
      transaction_type: txnType,
      description,
      reference_number: referenceNumber,
      party_name: partyName || null,
      project_name: projectName || null,
      project_code: projectCode || null,
      department: departmentName || null,
      category: categoryName,
      taxable_amount: taxableAmount,
      gst_rate: gstRate,
      gst_amount: gstAmount,
      tds_amount: tdsAmount,
      net_cash: netCash,
      account_name: accountName || null,
      payment_mode: entry.paymentMode || entry.payment_mode || 'NEFT',
      financial_year: financialYear,
      notes: entry.notes || null,
      status,
      updated_at: new Date().toISOString()
    };
  },

  /**
   * Saves or updates a transaction in public.fss_table_transactions
   */
  async saveTransaction(
    entry: any,
    parties: any[] = [],
    projects: any[] = [],
    departments: any[] = [],
    categories: any[] = [],
    accounts: any[] = []
  ): Promise<any> {
    if (!supabase) return null;
    try {
      const payload = this.formatTransactionPayload(entry, parties, projects, departments, categories, accounts);

      const targetId = entry.supabase_id || (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(entry.id)) ? entry.id : null);

      if (targetId) {
        const { data: updated, error: updErr } = await supabase
          .from('fss_table_transactions')
          .update(payload)
          .eq('id', targetId)
          .select()
          .maybeSingle();

        if (!updErr && updated) {
          return updated;
        }
      }

      // If no target ID or update didn't match, insert
      const { data: inserted, error: insErr } = await supabase
        .from('fss_table_transactions')
        .insert(payload)
        .select()
        .single();

      if (insErr) {
        console.error('Error inserting transaction into fss_table_transactions:', insErr);
        return null;
      }

      return inserted;
    } catch (err) {
      console.error('Exception saving transaction to Supabase:', err);
      return null;
    }
  },

  /**
   * Cancels (soft deletes) a transaction in fss_table_transactions
   */
  async cancelTransaction(idOrSupabaseId: string | number): Promise<boolean> {
    if (!supabase) return false;
    try {
      const targetId = String(idOrSupabaseId);
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetId);

      let query = supabase.from('fss_table_transactions').update({
        status: 'Cancelled',
        updated_at: new Date().toISOString()
      });

      if (isUUID) {
        query = query.eq('id', targetId);
      } else {
        query = query.eq('reference_number', targetId);
      }

      const { error } = await query;
      if (error) {
        console.error('Error cancelling transaction in Supabase:', error);
        return false;
      }
      return true;
    } catch (err) {
      console.error('Exception cancelling transaction in Supabase:', err);
      return false;
    }
  },

  /**
   * Permanently deletes a transaction from fss_table_transactions
   */
  async deleteTransaction(idOrSupabaseId: string | number): Promise<boolean> {
    if (!supabase) return false;
    try {
      const targetId = String(idOrSupabaseId);
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetId);

      let query = supabase.from('fss_table_transactions').delete();
      if (isUUID) {
        query = query.eq('id', targetId);
      } else {
        query = query.eq('reference_number', targetId);
      }

      const { error } = await query;
      if (error) {
        console.error('Error deleting transaction from Supabase:', error);
        return false;
      }
      return true;
    } catch (err) {
      console.error('Exception deleting transaction from Supabase:', err);
      return false;
    }
  },

  /**
   * Loads all transactions from public.fss_table_transactions
   */
  async loadTransactionsFromSupabase(): Promise<any[]> {
    if (!supabase) return [];
    try {
      let allRecords: any[] = [];
      let from = 0;
      const batchSize = 1000;

      while (true) {
        const { data, error } = await supabase
          .from('fss_table_transactions')
          .select('*')
          .order('transaction_date', { ascending: false })
          .range(from, from + batchSize - 1);

        if (error) {
          console.error('Error loading transactions from Supabase:', error);
          break;
        }

        if (!data || data.length === 0) break;
        allRecords = allRecords.concat(data);
        if (data.length < batchSize) break;
        from += batchSize;
      }

      return allRecords;
    } catch (err) {
      console.error('Exception loading transactions from Supabase:', err);
      return [];
    }
  },

  /**
   * Batch syncs initial local transactions into Supabase if fss_table_transactions is empty
   */
  async syncLocalTransactionsToSupabase(
    localEntries: any[],
    parties: any[] = [],
    projects: any[] = [],
    departments: any[] = [],
    categories: any[] = [],
    accounts: any[] = []
  ): Promise<any[]> {
    if (!supabase) return [];
    const valid = (localEntries || []).filter((e: any) => e.date && !e.deleted && e.type !== 'transfer');
    if (valid.length === 0) return [];

    const payloads = valid.map((e: any) => ({
      ...this.formatTransactionPayload(e, parties, projects, departments, categories, accounts),
      created_at: e.createdAt || new Date().toISOString()
    }));

    const synced: any[] = [];
    const CHUNK_SIZE = 100;
    for (let i = 0; i < payloads.length; i += CHUNK_SIZE) {
      const chunk = payloads.slice(i, i + CHUNK_SIZE);
      const originalEntriesChunk = valid.slice(i, i + CHUNK_SIZE);
      try {
        const { data, error } = await supabase
          .from('fss_table_transactions')
          .insert(chunk)
          .select();

        if (error) {
          console.error(`Error inserting transaction batch ${i / CHUNK_SIZE + 1}:`, error);
        } else if (data) {
          data.forEach((row: any, idx: number) => {
            if (originalEntriesChunk[idx]) {
              originalEntriesChunk[idx].supabase_id = row.id;
            }
          });
          synced.push(...data);
        }
      } catch (err) {
        console.warn(`Exception inserting transaction batch ${i / CHUNK_SIZE + 1}:`, err);
      }
    }
    return synced;
  }
};

export function getFinancialYear(dateStr: string): string {
  if (!dateStr) return '2026-27';
  const parts = dateStr.split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  if (isNaN(year) || isNaN(month)) return '2026-27';
  const startYear = month >= 4 ? year : year - 1;
  const endYearShort = String((startYear + 1) % 100).padStart(2, '0');
  return `${startYear}-${endYearShort}`;
}



