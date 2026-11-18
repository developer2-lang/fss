# fss-send-email

The Cashflow app now sends PI email through the protected same-origin
`/api/fss-send-email` Node.js endpoint. It uses Nodemailer directly because the
SMTP connection from the Supabase Edge Function was being closed. The browser
never receives SMTP credentials.

## Required server configuration

Set these variables in Vercel for production and preview deployments, and in
the root `.env` for local Vite development:

- `FSS_SMTP_HOST=smtp.gmail.com`
- `FSS_SMTP_PORT=465`
- `FSS_SMTP_SECURE=true`
- `FSS_SMTP_USER`
- `FSS_SMTP_PASSWORD`
- `FSS_MAIL_FROM` (the Gmail mailbox configured for SMTP)
- `FSS_MAIL_FROM_NAME=IUOVA DESIGN COMPANY`

For PI or Pay a Vendor attachments stored in Supabase Storage, also set
server-only `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. The service-role
key must never use a `VITE_` prefix or be exposed to the browser. The URL must
point to project `oscdtdlwdrwvjvteqcix`.

Keep Vercel Deployment Protection enabled for production and preview URLs. The
API route also rejects cross-origin requests. Restart local development after
changing `.env`; redeploy Vercel after changing its environment variables.

The API validates recipients and attachments. Inline attachments are limited
to 2.5 MB each and total attachments to 15 MB. PI emails, payment reminders,
and Pay a Vendor payment advice send through SMTP and update the outbox to Sent
or Failed; other email categories retain their existing outbox behavior.

The Supabase `fss-send-email` function is no longer used by the app's mail
route. It remains deployed, but should not be used for SMTP delivery.
