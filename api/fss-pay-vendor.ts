import type { IncomingMessage, ServerResponse } from 'node:http';

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
    if (size > 1_000_000) throw new Error('Pay a Vendor request is too large.');
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
    json(response, 405, { error: 'Use POST for Pay a Vendor operations.' });
    return;
  }

  const host = String(request.headers.host || '').toLowerCase();
  const origin = request.headers.origin;
  if (origin) {
    let originHost = '';
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      json(response, 403, { error: 'Invalid request origin.' });
      return;
    }
    if (!host || originHost !== host) {
      json(response, 403, { error: 'Cross-origin Pay a Vendor requests are not allowed.' });
      return;
    }
  }

  const supabaseUrl = process.env.VITE_SUPABASE_2_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_2_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const edgeAccessToken = process.env.FSS_EDGE_ACCESS_TOKEN;

  if (!supabaseUrl || !anonKey || !edgeAccessToken || edgeAccessToken.length < 32) {
    json(response, 503, { error: 'Pay a Vendor server access is not fully configured.' });
    return;
  }

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    json(response, 400, { error: error instanceof Error ? error.message : 'Invalid request body.' });
    return;
  }

  try {
    const upstream = await fetch(`${supabaseUrl.replace(/\/$/, '')}/functions/v1/fss-pay-vendor`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        'x-fss-dev-access-token': edgeAccessToken
      },
      body: JSON.stringify(body)
    });
    const responseText = await upstream.text();
    response.statusCode = upstream.status;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.end(responseText || JSON.stringify({ error: 'The Supabase Edge Function returned an empty response.' }));
  } catch (error) {
    console.error('Pay a Vendor Edge Function request failed:', error);
    json(response, 502, { error: 'Could not reach the protected Supabase Pay a Vendor function.' });
  }
}
