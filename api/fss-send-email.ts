import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import type { IncomingMessage, ServerResponse } from 'node:http';

const EMAIL_PROJECT_HOST = 'oscdtdlwdrwvjvteqcix.supabase.co';
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const MAX_INLINE_ATTACHMENT_BYTES = 2.5 * 1024 * 1024;
const ALLOWED_ATTACHMENT_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/tiff',
  'image/heic',
  'image/heif'
]);
const MAX_REQUEST_BYTES = 4 * 1024 * 1024;

type EmailEnvironment = Record<string, string | undefined>;

export class InvoiceEmailError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = 'InvoiceEmailError';
    this.statusCode = statusCode;
  }
}

function invalid(message: string): never {
  throw new InvoiceEmailError(message, 400);
}

function validEmail(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function safeFilename(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim() || value.length > 255) return null;
  return value.replace(/[\\/\r\n"]/g, '_').trim() || null;
}

function decodeBase64(value: string): Buffer {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    invalid('An email attachment contains invalid base64 data.');
  }
  return Buffer.from(value, 'base64');
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export async function sendInvoiceEmail(
  payload: Record<string, unknown>,
  env: EmailEnvironment
): Promise<{ success: true; messageId?: string; from: string; accepted: number; rejected: string[] }> {
  const toValues = Array.isArray(payload.to) ? payload.to : [payload.to];
  if (toValues.length === 0 || toValues.length > 10 || toValues.some((email) => !validEmail(email))) {
    invalid('Invalid recipient email address.');
  }
  const ccValues = payload.cc === undefined ? [] : Array.isArray(payload.cc) ? payload.cc : [payload.cc];
  if (ccValues.length > 10 || ccValues.some((email) => !validEmail(email))) {
    invalid('Invalid CC email address.');
  }
  if (typeof payload.subject !== 'string' || !payload.subject.trim() || payload.subject.length > 200) {
    invalid('A valid email subject is required.');
  }
  if (
    (typeof payload.text !== 'string' || !payload.text)
    && (typeof payload.html !== 'string' || !payload.html)
  ) {
    invalid('An HTML or text email body is required.');
  }
  if (
    (typeof payload.text === 'string' && payload.text.length > 500_000)
    || (typeof payload.html === 'string' && payload.html.length > 500_000)
  ) {
    invalid('The email body is too large.');
  }
  if (payload.attachments !== undefined && (!Array.isArray(payload.attachments) || payload.attachments.length > 10)) {
    invalid('A maximum of 10 attachments is supported.');
  }

  const host = (env.FSS_SMTP_HOST || '').trim();
  const username = env.FSS_SMTP_USER || '';
  const password = env.FSS_SMTP_PASSWORD || '';
  const from = env.FSS_MAIL_FROM || '';
  const fromName = env.FSS_MAIL_FROM_NAME || 'IUOVA DESIGN COMPANY';
  const port = Number(env.FSS_SMTP_PORT || '465');
  if (!host || !username || !password || !from) {
    throw new InvoiceEmailError(
      'Email service is missing server SMTP settings. Configure FSS_SMTP_HOST, FSS_SMTP_USER, FSS_SMTP_PASSWORD, and FSS_MAIL_FROM.'
    );
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 25) {
    throw new InvoiceEmailError('Invalid SMTP port. Use Gmail port 465 with TLS or 587 with STARTTLS.');
  }

  const secureSetting = env.FSS_SMTP_SECURE?.toLowerCase();
  if (secureSetting && secureSetting !== 'true' && secureSetting !== 'false') {
    throw new InvoiceEmailError('FSS_SMTP_SECURE must be either true or false.');
  }
  const secure = secureSetting ? secureSetting === 'true' : port === 465;
  if ((port === 465 && !secure) || (port === 587 && secure)) {
    throw new InvoiceEmailError('For Gmail, use port 465 with FSS_SMTP_SECURE=true or port 587 with FSS_SMTP_SECURE=false.');
  }

  const rawAttachments = (payload.attachments || []) as unknown[];
  const storageAttachments = rawAttachments.filter((value) => {
    const attachment = asObject(value);
    return typeof attachment?.storagePath === 'string';
  });
  let storageClient: ReturnType<typeof createClient> | null = null;
  if (storageAttachments.length) {
    const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_2_URL || env.VITE_SUPABASE_URL || '';
    const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY || '';
    if (!supabaseUrl || !serviceRoleKey) {
      throw new InvoiceEmailError(
        'Stored email attachments require SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the server environment.'
      );
    }
    try {
      if (new URL(supabaseUrl).host.toLowerCase() !== EMAIL_PROJECT_HOST) {
        throw new Error();
      }
    } catch {
      throw new InvoiceEmailError('The configured Supabase project URL does not match the PI attachment storage.');
    }
    storageClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
  }

  const mailAttachments: Array<{ filename: string; content: Buffer; contentType: string }> = [];
  let attachmentBytes = 0;
  for (const rawAttachment of rawAttachments) {
    const attachment = asObject(rawAttachment);
    if (!attachment) invalid('Invalid email attachment.');

    const filename = safeFilename(attachment.filename);
    const contentType = attachment.contentType;
    if (!filename || typeof contentType !== 'string' || !ALLOWED_ATTACHMENT_TYPES.has(contentType)) {
      invalid('Attachments must have a valid filename and be an image or PDF.');
    }

    let content: Buffer;
    if (typeof attachment.contentBase64 === 'string' && attachment.storagePath === undefined) {
      const encoded = attachment.contentBase64;
      if (encoded.length > Math.ceil(MAX_INLINE_ATTACHMENT_BYTES * 4 / 3) + 4) {
        invalid(`Attachment "${filename}" exceeds the 2.5 MB limit.`);
      }
      content = decodeBase64(encoded);
      if (content.byteLength > MAX_INLINE_ATTACHMENT_BYTES) {
        invalid(`Attachment "${filename}" exceeds the 2.5 MB limit.`);
      }
    } else if (
      typeof attachment.storagePath === 'string'
      && (
        attachment.bucket === 'proforma-invoices'
        || attachment.bucket === 'pay a vendor attachment'
        || attachment.bucket === 'client_payment'
      )
      && attachment.contentBase64 === undefined
    ) {
      const path = attachment.storagePath;
      const pathPattern = new RegExp(
        `^fss-form-attachments/${attachment.bucket}/(?:development|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/[A-Za-z0-9._-]+$`,
        'i'
      );
      if (!pathPattern.test(path)) {
        invalid(`Attachment "${filename}" is not in the approved storage path.`);
      }
      if (!storageClient) {
        throw new InvoiceEmailError('Supabase Storage access is not configured for this email attachment.');
      }
      const { data, error } = await storageClient.storage.from(attachment.bucket).download(path);
      if (error || !data) {
        throw new InvoiceEmailError(`Could not load email attachment "${filename}" from Supabase Storage.`);
      }
      if (data.size > MAX_ATTACHMENT_BYTES - attachmentBytes) {
        throw new InvoiceEmailError('Email attachments exceed the 15 MB total limit.', 413);
      }
      content = Buffer.from(await data.arrayBuffer());
    } else {
      invalid(`Attachment "${filename}" must provide file content or a PI storage path.`);
    }

    attachmentBytes += content.byteLength;
    if (attachmentBytes > MAX_ATTACHMENT_BYTES) {
      throw new InvoiceEmailError('Email attachments exceed the 15 MB total limit.', 413);
    }
    mailAttachments.push({ filename, content, contentType });
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user: username, pass: password },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000
  });
  try {
    const info = await transporter.sendMail({
      from: { name: fromName, address: from },
      to: toValues as string[],
      ...(ccValues.length ? { cc: ccValues as string[] } : {}),
      subject: payload.subject.trim(),
      ...(typeof payload.html === 'string' && payload.html ? { html: payload.html } : {}),
      ...(typeof payload.text === 'string' && payload.text ? { text: payload.text } : {}),
      ...(mailAttachments.length ? { attachments: mailAttachments } : {})
    });
    return {
      success: true,
      messageId: info.messageId,
      from,
      accepted: info.accepted.length,
      rejected: info.rejected.map((email) => String(email))
    };
  } finally {
    transporter.close();
  }
}

const json = (response: ServerResponse, status: number, body: Record<string, unknown>) => {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(body));
};

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_REQUEST_BYTES) throw new Error('Email request is too large.');
    chunks.push(buffer);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Request body must be a JSON object.');
  }
  return value;
}

export default async function handler(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== 'POST') {
    json(response, 405, { error: 'Use POST to send an invoice email.' });
    return;
  }

  const host = String(request.headers.host || '').toLowerCase();
  const origin = request.headers.origin;
  if (!origin) {
    json(response, 403, { error: 'An application origin is required to send email.' });
    return;
  }
  try {
    if (new URL(origin).host.toLowerCase() !== host) {
      json(response, 403, { error: 'Cross-origin email requests are not allowed.' });
      return;
    }
  } catch {
    json(response, 403, { error: 'Invalid email request origin.' });
    return;
  }

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    json(response, 400, { error: error instanceof Error ? error.message : 'Invalid email request.' });
    return;
  }

  try {
    const result = await sendInvoiceEmail(body, process.env);
    json(response, 200, result);
  } catch (error) {
    console.error('Invoice email delivery failed:', error);
    const statusCode = error instanceof InvoiceEmailError ? error.statusCode : 500;
    json(response, statusCode, {
      success: false,
      error: error instanceof Error ? error.message : 'Invoice email delivery failed.'
    });
  }
}
