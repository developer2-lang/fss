
import nodemailer from "nodemailer";
import { createClient } from "@supabase/supabase-js";



// CORS configuration
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, x-client-info, content-type, x-fss-dev-access-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

// Read SMTP configuration from Supabase Secrets
const SMTP_HOST = (Deno.env.get("FSS_SMTP_HOST") ?? "").trim();
const SMTP_PORT = Number(Deno.env.get("FSS_SMTP_PORT") ?? "465");
const SMTP_SECURE =
  (Deno.env.get("FSS_SMTP_SECURE") ?? "true").toLowerCase() === "true";
const SMTP_USER = Deno.env.get("FSS_SMTP_USER") ?? "";
const SMTP_PASSWORD = Deno.env.get("FSS_SMTP_PASSWORD") ?? "";
const MAIL_FROM = Deno.env.get("FSS_MAIL_FROM") ?? "";
const MAIL_FROM_NAME =
  Deno.env.get("FSS_MAIL_FROM_NAME") ?? "IUOVA DESIGN COMPANY";

const EDGE_ACCESS_TOKEN = Deno.env.get("FSS_EDGE_ACCESS_TOKEN") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MAX_REQUEST_BYTES = 4 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const MAX_INLINE_ATTACHMENT_BYTES = 2.5 * 1024 * 1024;
const INLINE_ATTACHMENT_BUCKETS = new Set(["proforma-invoices"]);
const ALLOWED_ATTACHMENT_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/tiff",
  "image/heic",
  "image/heif",
]);

function constantTimeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    difference |= (a[i] || 0) ^ (b[i] || 0);
  }
  return difference === 0;
}

function validEmail(value: unknown): value is string {
  return typeof value === "string" &&
    value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function safeFilename(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim() || value.length > 255) {
    return null;
  }
  const filename = value.replace(/[\\/\r\n"]/g, "_").trim();
  return filename || null;
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function createSmtpTransport() {
  let connectionHost = SMTP_HOST;
  const isIpAddress = /^[0-9.]+$/.test(SMTP_HOST) || SMTP_HOST.includes(":");
  if (!isIpAddress) {
    let addresses: string[];
    try {
      addresses = await Deno.resolveDns(SMTP_HOST, "A");
    } catch (error) {
      throw new Error(`Could not resolve SMTP host "${SMTP_HOST}": ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!addresses.length) throw new Error(`No IPv4 address was found for SMTP host "${SMTP_HOST}".`);
    connectionHost = addresses[0];
  }

  return nodemailer.createTransport({
    host: connectionHost,
    servername: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASSWORD,
    },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  });
}

Deno.serve(async (req: Request) => {
  // Handle browser preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return Response.json(
      { success: false, error: "Method not allowed" },
      { status: 405, headers: corsHeaders },
    );
  }

  try {
    const expectedToken = EDGE_ACCESS_TOKEN;
    const presentedToken = req.headers.get("x-fss-dev-access-token") ?? "";
    if (expectedToken.length < 32) {
      return Response.json(
        { success: false, error: "Email service access is not configured" },
        { status: 503, headers: corsHeaders },
      );
    }
    if (!constantTimeEqual(presentedToken, expectedToken)) {
      return Response.json(
        { success: false, error: "Email service access token is invalid" },
        { status: 401, headers: corsHeaders },
      );
    }

    const missing = [
      ["FSS_SMTP_HOST", SMTP_HOST],
      ["FSS_SMTP_USER", SMTP_USER],
      ["FSS_SMTP_PASSWORD", SMTP_PASSWORD],
      ["FSS_MAIL_FROM", MAIL_FROM],
      ["SUPABASE_URL", SUPABASE_URL],
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);

    if (missing.length > 0) {
      return Response.json(
        {
          success: false,
          error: "Server configuration is incomplete",
          missing,
        },
        { status: 500, headers: corsHeaders },
      );
    }

    if (
      !Number.isInteger(SMTP_PORT) ||
      SMTP_PORT < 1 ||
      SMTP_PORT > 65535
    ) {
      return Response.json(
        { success: false, error: "Invalid SMTP port" },
        { status: 500, headers: corsHeaders },
      );
    }

    if (SMTP_PORT === 25 || SMTP_PORT === 587) {
      return Response.json(
        { success: false, error: "Supabase Edge Functions blocks SMTP ports 25 and 587. Use port 465 with TLS enabled." },
        { status: 500, headers: corsHeaders },
      );
    }

    const contentLength = Number(req.headers.get("content-length") ?? "0");
    if (contentLength > MAX_REQUEST_BYTES) {
      return Response.json(
        { success: false, error: "Request too large" },
        { status: 413, headers: corsHeaders },
      );
    }

    const requestBytes = await req.arrayBuffer();
    if (requestBytes.byteLength > MAX_REQUEST_BYTES) {
      return Response.json(
        { success: false, error: "Request too large" },
        { status: 413, headers: corsHeaders },
      );
    }

    let body: Record<string, unknown>;
    try {
      const parsed = JSON.parse(new TextDecoder().decode(requestBytes));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Request body must be an object");
      }
      body = parsed;
    } catch (error) {
      return Response.json(
        { success: false, error: error instanceof Error ? error.message : "Invalid JSON request body" },
        { status: 400, headers: corsHeaders },
      );
    }

    const { to, cc, subject, html, text, attachments } = body;

    const recipientValues: unknown[] = Array.isArray(to) ? to : [to];

    if (
      recipientValues.length === 0 ||
      recipientValues.length > 10 ||
      recipientValues.some((email: unknown) => !validEmail(email))
    ) {
      return Response.json(
        { success: false, error: "Invalid recipient email address" },
        { status: 400, headers: corsHeaders },
      );
    }
    const recipients = recipientValues as string[];

    const ccValues: unknown[] = cc === undefined ? [] : Array.isArray(cc) ? cc : [cc];
    if (ccValues.length > 10 || ccValues.some((email: unknown) => !validEmail(email))) {
      return Response.json(
        { success: false, error: "Invalid CC email address" },
        { status: 400, headers: corsHeaders },
      );
    }
    const ccRecipients = ccValues as string[];

    if (
      typeof subject !== "string" ||
      subject.trim().length === 0 ||
      subject.length > 200
    ) {
      return Response.json(
        { success: false, error: "Valid subject is required" },
        { status: 400, headers: corsHeaders },
      );
    }

    if (
      (typeof html !== "string" || html.length === 0) &&
      (typeof text !== "string" || text.length === 0)
    ) {
      return Response.json(
        { success: false, error: "HTML or text email body is required" },
        { status: 400, headers: corsHeaders },
      );
    }

    if (
      (typeof html === "string" && html.length > 500000) ||
      (typeof text === "string" && text.length > 500000)
    ) {
      return Response.json(
        { success: false, error: "Email body is too large" },
        { status: 400, headers: corsHeaders },
      );
    }

    if (attachments !== undefined && (!Array.isArray(attachments) || attachments.length > 10)) {
      return Response.json(
        { success: false, error: "A maximum of 10 attachments is supported" },
        { status: 400, headers: corsHeaders },
      );
    }

    const mailAttachments: Array<{ filename: string; content: Uint8Array; contentType: string }> = [];
    let attachmentBytes = 0;
    const storageClient = SUPABASE_SERVICE_ROLE_KEY
      ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
      : null;

    for (const rawAttachment of (attachments || []) as Record<string, unknown>[]) {
      if (!rawAttachment || typeof rawAttachment !== "object" || Array.isArray(rawAttachment)) {
        return Response.json(
          { success: false, error: "Invalid attachment" },
          { status: 400, headers: corsHeaders },
        );
      }
      const filename = safeFilename(rawAttachment.filename);
      const contentType = rawAttachment.contentType;
      if (!filename || typeof contentType !== "string" || !ALLOWED_ATTACHMENT_TYPES.has(contentType)) {
        return Response.json(
          { success: false, error: "Attachments must have a valid filename and be an image or PDF" },
          { status: 400, headers: corsHeaders },
        );
      }

      let content: Uint8Array;
      if (typeof rawAttachment.contentBase64 === "string" && rawAttachment.storagePath === undefined) {
        const encoded = rawAttachment.contentBase64;
        if (
          encoded.length > Math.ceil(MAX_INLINE_ATTACHMENT_BYTES * 4 / 3) + 4 ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
        ) {
          return Response.json(
            { success: false, error: `Attachment "${filename}" is invalid or too large` },
            { status: 400, headers: corsHeaders },
          );
        }
        try {
          content = decodeBase64(encoded);
        } catch {
          return Response.json(
            { success: false, error: `Attachment "${filename}" is not valid base64` },
            { status: 400, headers: corsHeaders },
          );
        }
        if (content.byteLength > MAX_INLINE_ATTACHMENT_BYTES) {
          return Response.json(
            { success: false, error: `Attachment "${filename}" exceeds the 2.5 MB limit` },
            { status: 400, headers: corsHeaders },
          );
        }
      } else if (
        typeof rawAttachment.storagePath === "string" &&
        typeof rawAttachment.bucket === "string" &&
        rawAttachment.contentBase64 === undefined
      ) {
        const bucket = rawAttachment.bucket;
        const path = rawAttachment.storagePath;
        if (
          !INLINE_ATTACHMENT_BUCKETS.has(bucket) ||
          !/^fss-form-attachments\/proforma-invoices\/(?:development|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/[A-Za-z0-9._-]+$/i.test(path)
        ) {
          return Response.json(
            { success: false, error: `Attachment "${filename}" is not in the PI attachment storage path` },
            { status: 400, headers: corsHeaders },
          );
        }
        if (!storageClient) {
          return Response.json(
            { success: false, error: "Supabase storage access is not configured for invoice attachments" },
            { status: 500, headers: corsHeaders },
          );
        }
        const { data, error } = await storageClient.storage.from(bucket).download(path);
        if (error || !data) {
          throw new Error(`Could not load PI attachment "${filename}" from Supabase Storage`);
        }
        if (data.size > MAX_ATTACHMENT_BYTES - attachmentBytes) {
          return Response.json(
            { success: false, error: "Email attachments exceed the 15 MB total limit" },
            { status: 413, headers: corsHeaders },
          );
        }
        content = new Uint8Array(await data.arrayBuffer());
      } else {
        return Response.json(
          { success: false, error: `Attachment "${filename}" must provide file content or a PI storage path` },
          { status: 400, headers: corsHeaders },
        );
      }

      attachmentBytes += content.byteLength;
      if (attachmentBytes > MAX_ATTACHMENT_BYTES) {
        return Response.json(
          { success: false, error: "Email attachments exceed the 15 MB total limit" },
          { status: 413, headers: corsHeaders },
        );
      }
      mailAttachments.push({ filename, content, contentType });
    }

    const transporter = await createSmtpTransport();
    let info;
    try {
      info = await transporter.sendMail({
        from: {
          name: MAIL_FROM_NAME,
          address: MAIL_FROM,
        },
        to: recipients,
        ...(ccRecipients.length ? { cc: ccRecipients } : {}),
        subject: subject.trim(),
        ...(typeof html === "string" && html.length > 0 ? { html } : {}),
        ...(typeof text === "string" && text.length > 0 ? { text } : {}),
        ...(mailAttachments.length ? { attachments: mailAttachments } : {}),
      });
    } finally {
      transporter.close();
    }

    return Response.json(
      {
        success: true,
        message: "Email accepted by SMTP server",
        messageId: info.messageId,
        from: MAIL_FROM,
        accepted: info.accepted.length,
        rejected: info.rejected.map((email: unknown) => String(email)),
      },
      { status: 200, headers: corsHeaders },
    );
  } catch (error) {
    console.error(
      "Email sending failed:",
      error instanceof Error ? error.message : "Unknown error",
    );

    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Email sending failed. Check Edge Function logs.",
      },
      { status: 500, headers: corsHeaders },
    );
  }
});
