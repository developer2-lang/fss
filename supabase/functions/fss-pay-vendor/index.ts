import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const TABLE = 'fss_form_pay_vendor';
const ATTACHMENT_BUCKETS = new Set([
  'other_income',
  'client_payment',
  'other_expense',
  'tax_saturatory',
  'pay an employee attachment',
  'pay a vendor attachment',
  'order_pos_storage',
  'proforma-invoices'
]);
const ATTACHMENT_ROOT = 'fss-form-attachments';
const ALLOWED_ATTACHMENT_TYPES = new Set([
  'application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'image/bmp', 'image/tiff', 'image/heic', 'image/heif'
]);
const ALLOWED_COLUMNS = new Set([
  'recorded_by', 'vendor_id', 'vendor_name', 'category', 'department',
  'vendor_bank_name', 'vendor_account_number', 'vendor_ifsc', 'credit_days',
  'bill_amount_before_gst', 'bill_number', 'bill_date', 'gst_rate', 'gst_type',
  'gst_amount', 'input_gst_claimable', 'tds_rate', 'tds_section', 'tds_amount',
  'payment_date', 'payment_mode', 'paid_from', 'utr_cheque_reference',
  'amount_paid', 'description', 'project', 'notes', 'repeat_enabled',
  'repeat_frequency', 'repeat_day', 'payment_advice_enabled', 'payment_advice_to',
  'payment_advice_email', 'attachments', 'net_cash_paid'
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) difference |= (a[i] || 0) ^ (b[i] || 0);
  return difference === 0;
}

function sanitizeData(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Request data must be an object.');
  const source = value as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(source)) {
    if (key === 'created_by' || key === 'id' || key === 'created_at' || key === 'updated_at') continue;
    if (!ALLOWED_COLUMNS.has(key)) throw new Error(`Unsupported field: ${key}`);
    data[key] = field;
  }
  return data;
}

async function deterministicRowId(ownerId: string | null, key: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`fss-pay-vendor:${ownerId || 'development'}:${key}`)
  ));
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

Deno.serve(async request => {
  if (request.method !== 'POST') return json(405, { error: 'POST is required.' });

  const expectedToken = Deno.env.get('FSS_EDGE_ACCESS_TOKEN') || '';
  if (expectedToken.length < 32) return json(503, { error: 'Edge Function access secret is not configured.' });
  const presentedToken = request.headers.get('x-fss-dev-access-token') || '';
  if (!constantTimeEqual(presentedToken, expectedToken)) return json(401, { error: 'Development access token is invalid. Restart the app after configuring the local proxy secret.' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!supabaseUrl || !serviceRoleKey) return json(503, { error: 'Supabase Edge Function database secrets are not configured.' });

  const ownerId = Deno.env.get('FSS_DEFAULT_CREATED_BY') || null;
  if (ownerId && !UUID_RE.test(ownerId)) return json(503, { error: 'FSS_DEFAULT_CREATED_BY must be a valid Auth user UUID.' });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'Request body must be valid JSON.' });
  }

  const operation = body.operation;
  const id = typeof body.id === 'string' ? body.id : '';
  if (!['select', 'insert', 'update', 'delete', 'create_form_attachment_upload', 'delete_form_attachment'].includes(String(operation))) {
    return json(400, { error: 'Unsupported Pay a Vendor operation.' });
  }
  if (['update', 'delete'].includes(String(operation)) && !UUID_RE.test(id)) {
    return json(400, { error: 'A valid row UUID is required for update and delete.' });
  }
  if (operation === 'select' && id && !UUID_RE.test(id)) return json(400, { error: 'The row id must be a valid UUID.' });

  const database = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    db: {
      schema: 'fss'
    }
  });
  const scopeOwner = (query: any) => ownerId ? query.eq('created_by', ownerId) : query.is('created_by', null);

  try {
    if (operation === 'create_form_attachment_upload') {
      const bucket = String(body.bucket || '');
      const name = String(body.name || '').trim();
      const contentType = String(body.content_type || '');
      if (!ATTACHMENT_BUCKETS.has(bucket)) return json(400, { error: 'Unsupported form attachment bucket.' });
      if (!name || name.length > 255) return json(400, { error: 'A valid attachment filename is required.' });
      if (!ALLOWED_ATTACHMENT_TYPES.has(contentType)) {
        return json(400, { error: 'Only images and PDFs can be attached.' });
      }
      const safeName = name.replace(/[^A-Za-z0-9._-]/g, '_') || 'attachment';
      const ownerScope = ownerId || 'development';
      const path = `${ATTACHMENT_ROOT}/${bucket}/${ownerScope}/${crypto.randomUUID()}-${safeName}`;
      const storage = database.storage.from(bucket);
      const { data: signedUpload, error: signedUploadError } = await storage.createSignedUploadUrl(path);
      if (signedUploadError) throw signedUploadError;
      return json(200, {
        data: {
          path,
          token: signedUpload.token,
          url: bucket === 'proforma-invoices' ? null : storage.getPublicUrl(path).data.publicUrl
        }
      });
    }

    if (operation === 'delete_form_attachment') {
      const bucket = String(body.bucket || '');
      const path = String(body.path || '');
      if (!ATTACHMENT_BUCKETS.has(bucket)) return json(400, { error: 'Unsupported form attachment bucket.' });
      const ownerScope = ownerId || 'development';
      const allowedPrefix = `${ATTACHMENT_ROOT}/${bucket}/${ownerScope}/`;
      if (!path.startsWith(allowedPrefix) || path.slice(allowedPrefix.length).includes('/')) {
        return json(403, { error: 'Attachment path is outside the configured form and owner scope.' });
      }
      const { error } = await database.storage.from(bucket).remove([path]);
      if (error) throw error;
      return json(200, { data: { path } });
    }

    if (operation === 'select') {
      let query = scopeOwner(database.from(TABLE).select('*'));
      if (id) query = query.eq('id', id);
      const { data, error } = await query.order('payment_date', { ascending: false }).limit(id ? 1 : 500);
      if (error) throw error;
      return json(200, { data: id ? (data?.[0] || null) : (data || []) });
    }

    if (operation === 'insert') {
      const data = sanitizeData(body.data);
      if (!String(data.vendor_name || '').trim() || !String(data.category || '').trim() || !String(data.payment_date || '').trim()) {
        return json(400, { error: 'Vendor, category and payment date are required.' });
      }
      const key = String(body.idempotency_key || '');
      const rowId = key ? await deterministicRowId(ownerId, key) : crypto.randomUUID();
      const { data: row, error } = await database.from(TABLE)
        .insert({ ...data, id: rowId, created_by: ownerId })
        .select('*')
        .single();
      if (error?.code === '23505' && key) {
        const { data: prior, error: priorError } = await scopeOwner(database.from(TABLE).select('*')).eq('id', rowId).maybeSingle();
        if (priorError) throw priorError;
        if (prior) return json(200, { data: prior, replayed: true });
      }
      if (error) throw error;
      return json(201, { data: row });
    }

    if (operation === 'update') {
      const data = sanitizeData(body.data);
      const { data: row, error } = await scopeOwner(database.from(TABLE).update({ ...data, updated_at: new Date().toISOString() }).eq('id', id))
        .select('*')
        .maybeSingle();
      if (error) throw error;
      if (!row) return json(404, { error: 'Vendor payment was not found in this development owner scope.' });
      return json(200, { data: row });
    }

    const { data: row, error } = await scopeOwner(database.from(TABLE).delete().eq('id', id))
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!row) return json(404, { error: 'Vendor payment was not found in this development owner scope.' });
    return json(200, { data: row });
  } catch (error) {
    console.error('fss-pay-vendor database operation failed:', error);
    return json(500, { error: `Pay a Vendor ${String(operation)} failed: ${(error as Error)?.message || 'database error'}` });
  }
});
