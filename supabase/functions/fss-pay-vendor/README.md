# Pay a Vendor Edge Function

The IUOVA app uses a local role selector rather than Supabase Auth. Browser-side PostgREST writes therefore cannot satisfy the table policy's `auth.uid()` check. Vendor payment database operations now go through this function instead.

## Access model for local development

- The browser calls `/api/fss-pay-vendor` on the local Vite server.
- The Vite middleware accepts only loopback requests with a same-origin `Origin` header and keeps `FSS_EDGE_ACCESS_TOKEN` on the server.
- The middleware forwards to this Edge Function with the access token.
- The Edge Function checks the token in constant time and exposes allowlisted CRUD operations on `fss_form_pay_vendor`, plus scoped signed-upload and deletion operations for the `pay a vendor attachment` Storage bucket.
- `SUPABASE_SERVICE_ROLE_KEY` is read only inside the Edge Function runtime. Supabase injects it there; never put it in an app `.env` or `VITE_*` variable.
- RLS remains enabled. The function uses the privileged client, so it applies an explicit owner scope (`FSS_DEFAULT_CREATED_BY`) itself. If no default owner is configured, it scopes records to `created_by IS NULL` for this development installation.

The Vite proxy is development-only. Production requests go through the root-level Vercel API function. The Vercel project must keep Deployment Protection set to Vercel Authentication for **all** deployment URLs, including production aliases and custom domains. This lets staff use the app without a separate Supabase sign-in while keeping the API behind the Vercel team login.

The browser never receives `FSS_EDGE_ACCESS_TOKEN` or `SUPABASE_SERVICE_ROLE_KEY`. Keep the Edge Function token and service-role key in server-side secret stores only. Supabase RLS remains enabled; this function scopes every operation to the configured owner (`FSS_DEFAULT_CREATED_BY`, or `created_by IS NULL` when unset).

## Configure and deploy

1. Generate a random token with at least 32 bytes of entropy. Put the same value in the root `.env` as `FSS_EDGE_ACCESS_TOKEN` and in `supabase/.env.pay-vendor.local` as `FSS_EDGE_ACCESS_TOKEN=...`. Set this token as a sensitive Vercel Production environment variable with the same name.
2. Set Vercel Deployment Protection to Vercel Authentication with scope `all`. Do not expose the API on an unprotected Vercel alias.
3. Optionally add `FSS_DEFAULT_CREATED_BY=<Auth user UUID>` to `supabase/.env.pay-vendor.local` to scope rows to a dedicated Supabase Auth user.
4. Link the Supabase CLI to the project in this workspace, then set the function secrets and deploy:

   ```powershell
   supabase secrets set --env-file supabase/.env.pay-vendor.local
   supabase functions deploy fss-pay-vendor
   ```

   The function gateway has `verify_jwt = false` because it receives only server-to-server requests from the loopback-only local proxy or the Vercel API protected by Vercel Authentication. The handler still rejects every request without the private access token. Do not remove that check or place the token in browser code.

## Operations

POST JSON operations are `select`, `insert`, `update`, `delete`, `create_form_attachment_upload`, and `delete_form_attachment`. Upload links are generated only for image/PDF files and paths are scoped to the configured owner; file contents upload directly from the browser to Supabase Storage. Attachment operations support all existing form buckets: `other_income`, `client_payment`, `other_expense`, `tax_saturatory`, `pay an employee attachment`, and `pay a vendor attachment`. The function permits only fields belonging to `fss_form_pay_vendor`, assigns `created_by` from the configured owner scope, and uses a deterministic row UUID for retries of app-originated inserts. No other table is accessed.
