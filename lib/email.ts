import "server-only";

// Generic Resend adapter, reusing the exact provider/domain the marketing
// site's contact form already sends through successfully (see
// app/api/contact/route.ts and docs/adr/0001 section 11.1) - RESEND_API_KEY
// is already configured for both Production and Preview in Vercel.
//
// This module intentionally does NOT touch app/api/contact/route.ts -
// that route keeps working exactly as it did before Phase 4, unmodified.

// Phase 11 addition (nightly backup + data export to email, per Ariel's
// direct request): Resend's /emails endpoint accepts a plain `attachments`
// array of { filename, content } where `content` is base64 - no multipart
// upload, no separate endpoint, so this is additive to the JSON body
// above rather than a different code path. `content` accepts a Buffer
// directly (what lib/xlsx.ts's toXlsx()/toXlsxWorkbook() already return)
// so callers never have to think about base64 themselves.
export interface SendEmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
}

export interface SendEmailInput {
  to: string[];
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  attachments?: SendEmailAttachment[];
}

export interface SendEmailResult {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
}

const FROM_ADDRESS = "Ankora <alerts@ankora.co.il>";

/// Sends one email via the Resend REST API. Never throws - callers (the
/// alert-evaluation domain logic) always want a result object they can
/// log into EmailDelivery, not an exception that would abort the
/// surrounding best-effort, non-fatal evaluation call.
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY is not set" };
  }
  if (input.to.length === 0) {
    return { ok: false, error: "No recipients" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: input.to,
        reply_to: input.replyTo,
        subject: input.subject,
        text: input.text,
        html: input.html,
        attachments: input.attachments?.map((a) => ({
          filename: a.filename,
          content: Buffer.isBuffer(a.content) ? a.content.toString("base64") : a.content,
          ...(a.contentType ? { content_type: a.contentType } : {}),
        })),
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { ok: false, error: `Resend API error ${res.status}: ${errText}` };
    }

    const body = (await res.json()) as { id?: string };
    return { ok: true, providerMessageId: body.id };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Unknown error sending email" };
  }
}
