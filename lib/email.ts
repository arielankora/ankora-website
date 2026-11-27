import "server-only";
import { unreachableLinksIn } from "@/lib/site";
import { isProductionDeployment } from "@/lib/env";

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
  /// Copied on the message (24.11.2026: a disconnected WhatsApp goes to its
  /// owner with Ariel and Hadas on copy).
  cc?: string[];
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  attachments?: SendEmailAttachment[];
  /// false only for the system issue alert itself (lib/system-issues.ts),
  /// so an email outage does not report itself in a loop.
  reportFailure?: boolean;
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
/// Send one email. Never throws: the result says whether it went out.
///
/// 27.11.2026 (silent failures audit): six callers ignored a failed result
/// and nothing anywhere recorded it, so an email that did not go out left
/// no trace. A failure is now a system issue (lib/system-issues.ts), whatever
/// the caller does with the result.
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const result = await deliver(input);
  if (!result.ok && input.reportFailure !== false) await reportEmailFailure(input, result.error ?? "");
  return result;
}

/// The kind of failure, which is also the issue's key: one open issue per
/// kind, not one per email.
export function emailFailureKind(error: string): string | null {
  if (error === "RESEND_API_KEY is not set") return isProductionDeployment() ? "missing-key" : null;
  if (error === "No recipients") return "no-recipients";
  if (error.startsWith("Refusing to send")) return "unreachable-link";
  const status = /^Resend API error (\d{3})/.exec(error)?.[1];
  if (status) return `provider-${status}`;
  return "network";
}

/// Where an email issue's detail starts naming the subject. A subject can
/// name a client, so the connector cuts the detail here
/// (lib/app-domain/system-issues.ts, issuesForAi).
export const EMAIL_SUBJECT_MARK = " | נושא: ";

async function reportEmailFailure(input: SendEmailInput, error: string): Promise<void> {
  const kind = emailFailureKind(error);
  if (!kind) return;
  const { reportIssue } = await import("@/lib/system-issues");
  await reportIssue({
    area: "email",
    key: kind,
    title: "מייל לא נשלח",
    // The subject names what kind of email it was; the body never goes here.
    detail: `${error.slice(0, 300)}${EMAIL_SUBJECT_MARK}${input.subject.slice(0, 120)}`,
    severity: "CRITICAL",
  });
}

async function deliver(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY is not set" };
  }
  if (input.to.length === 0) {
    return { ok: false, error: "No recipients" };
  }

  // 22.9.2026. An invite went out carrying the production deployment's
  // own *.vercel.app address, which Vercel's deployment protection
  // answers with a sign-in wall. The recipient had a valid token and
  // still could not reach Ankora.
  //
  // The origin is chosen correctly upstream now (lib/email-templates.ts),
  // and this is the same rule stated once more at the door, because that
  // is the only place every outgoing message passes through. A future
  // caller that builds its own link cannot get past here.
  //
  // Production refuses to send rather than quietly rewriting: a message
  // with an unopenable link is worthless to its recipient anyway, and the
  // invite screen already surfaces a failed send together with a link the
  // admin can relay by hand. A loud failure in front of one admin beats a
  // dead link in front of a new client. Previews are exempt on purpose -
  // there, a *.vercel.app link is the correct link.
  if (isProductionDeployment()) {
    const unreachable = unreachableLinksIn(`${input.text}\n${input.html ?? ""}`);
    if (unreachable.length > 0) {
      return {
        ok: false,
        error: `Refusing to send: ${unreachable[0]} is behind deployment protection and the recipient cannot open it`,
      };
    }
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
        cc: input.cc?.length ? input.cc : undefined,
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
