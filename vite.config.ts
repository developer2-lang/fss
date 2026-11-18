import { defineConfig, loadEnv, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { InvoiceEmailError, sendInvoiceEmail } from './api/invoice-email-sender.ts';

function isLoopbackAddress(address = ''): boolean {
  return address === '::1'
    || address === '::ffff:127.0.0.1'
    || address === '127.0.0.1'
    || address.startsWith('127.');
}

function payVendorDevProxy(env: Record<string, string>, command: string): Plugin {
  return {
    name: 'fss-pay-vendor-edge-dev-proxy',
    apply: 'serve',
    configureServer(server) {
      if (command !== 'serve') return;
      server.middlewares.use('/api/fss-pay-vendor', async (req, res) => {
        const send = (status: number, error: string) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error }));
        };

        if (req.method !== 'POST') return send(405, 'Use POST for Pay a Vendor operations.');
        const host = String(req.headers.host || '').toLowerCase();
        const hostIsLocal = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host);
        if (!hostIsLocal || !isLoopbackAddress(req.socket.remoteAddress || '')) {
          return send(403, 'The Pay a Vendor proxy is available only from this development computer.');
        }
        const origin = req.headers.origin;
        if (!origin || new URL(origin).host.toLowerCase() !== host || !['http:', 'https:'].includes(new URL(origin).protocol)) {
          return send(403, 'Cross-origin Pay a Vendor requests are not allowed.');
        }

        const accessToken = env.FSS_EDGE_ACCESS_TOKEN;
        const projectUrl = env.VITE_SUPABASE_2_URL || env.VITE_SUPABASE_URL;
        const anonKey = env.VITE_SUPABASE_2_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
        if (!accessToken || accessToken.length < 32) {
          return send(503, 'FSS_EDGE_ACCESS_TOKEN is missing or too short in the local server environment.');
        }
        if (!projectUrl || !anonKey) return send(503, 'Supabase URL or anon key is missing from the local server environment.');

        try {
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of req) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += buffer.length;
            if (size > 1_000_000) return send(413, 'Pay a Vendor request is too large.');
            chunks.push(buffer);
          }
          const requestBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const upstream = await fetch(`${projectUrl.replace(/\/$/, '')}/functions/v1/fss-pay-vendor`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': anonKey,
              'x-fss-dev-access-token': accessToken
            },
            body: JSON.stringify(requestBody)
          });
          const bodyText = await upstream.text();
          res.statusCode = upstream.status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(bodyText || JSON.stringify({ error: 'The Supabase Edge Function returned an empty response.' }));
        } catch (error: any) {
          send(502, `Could not reach the protected Supabase Edge Function: ${error?.message || 'network error'}`);
        }
      });
    }
  };
}

function sendEmailDevProxy(env: Record<string, string>, command: string): Plugin {
  return {
    name: 'fss-send-email-edge-dev-proxy',
    apply: 'serve',
    configureServer(server) {
      if (command !== 'serve') return;
      server.middlewares.use('/api/fss-send-email', async (req, res) => {
        const send = (status: number, error: string) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify({ success: false, error }));
        };
        if (req.method !== 'POST') return send(405, 'Use POST to send an invoice email.');

        const host = String(req.headers.host || '').toLowerCase();
        const hostIsLocal = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host);
        if (!hostIsLocal || !isLoopbackAddress(req.socket.remoteAddress || '')) {
          return send(403, 'The email proxy is available only from this development computer.');
        }
        try {
          const origin = req.headers.origin;
          const parsedOrigin = origin ? new URL(origin) : null;
          if (!parsedOrigin || parsedOrigin.host.toLowerCase() !== host || !['http:', 'https:'].includes(parsedOrigin.protocol)) {
            return send(403, 'Cross-origin email requests are not allowed.');
          }
        } catch {
          return send(403, 'Invalid email request origin.');
        }

        try {
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of req) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += buffer.length;
            if (size > 4 * 1024 * 1024) return send(413, 'Email request is too large.');
            chunks.push(buffer);
          }
          const requestBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!requestBody || typeof requestBody !== 'object' || Array.isArray(requestBody)) {
            return send(400, 'Request body must be a JSON object.');
          }
          const result = await sendInvoiceEmail(requestBody, env);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(result));
        } catch (error: unknown) {
          const statusCode = error instanceof InvoiceEmailError ? error.statusCode : 500;
          const message = error instanceof Error ? error.message : 'Invoice email delivery failed.';
          send(statusCode, message);
        }
      });
    }
  };
}

export default defineConfig(({ mode, command }) => {
  // Keep the root .env authoritative while supporting Supabase CLI's supabase/.env.
  // Only public Supabase URL/key values are exposed to the browser bundle.
  const rootEnv = loadEnv(mode, process.cwd(), '');
  const supabaseEnv = loadEnv(mode, resolve(process.cwd(), 'supabase'), '');
  const env = { ...supabaseEnv, ...rootEnv };
  const clientEnv = {
    VITE_SUPABASE_URL: rootEnv.VITE_SUPABASE_URL || supabaseEnv.VITE_SUPABASE_URL,
    VITE_SUPABASE_2_URL: rootEnv.VITE_SUPABASE_2_URL || supabaseEnv.VITE_SUPABASE_2_URL,
    VITE_SUPABASE_ANON_KEY: rootEnv.VITE_SUPABASE_ANON_KEY || supabaseEnv.VITE_SUPABASE_ANON_KEY,
    VITE_SUPABASE_2_ANON_KEY: rootEnv.VITE_SUPABASE_2_ANON_KEY || supabaseEnv.VITE_SUPABASE_2_ANON_KEY
  };
  const define = Object.entries(clientEnv).reduce<Record<string, string>>((values, [key, value]) => {
    if (value) values[`import.meta.env.${key}`] = JSON.stringify(value);
    return values;
  }, {});

  return {
    plugins: [react(), payVendorDevProxy(env, command), sendEmailDevProxy(env, command)],
    define,
    server: {
      host: '127.0.0.1',
      port: 5174,
      strictPort: true,
      open: true
    }
  };
});
