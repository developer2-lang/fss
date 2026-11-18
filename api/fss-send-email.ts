import type { IncomingMessage, ServerResponse } from 'node:http';
import { InvoiceEmailError, sendInvoiceEmail } from './invoice-email-sender.ts';

const MAX_REQUEST_BYTES = 4 * 1024 * 1024;

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
