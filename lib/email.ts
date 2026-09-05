import "server-only";

// Generic Resend adapter, reusing the exact provider/domain the marketing
// site's contact form already sends through successfully (see
// app/api/contact/route.ts and docs/adr/0001 section 11.1) - RESEND_API_KEY
// is already configured for both Production and Preview in Vercel.
//
// This module intentionally does NOT touch app/api/contact/route.ts -
// that route keeps working exactly as it did before Phase 4, unmodified.

export interface SendEmailInput {
  to: string[];
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
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
