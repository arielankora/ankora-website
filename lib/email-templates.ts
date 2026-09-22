import "server-only";
import { SITE_URL } from "@/lib/site";

// Portal phase 0. Every transactional email the app sends to a PERSON
// (invite, sign-in link) is built here, so there is one Hebrew RTL
// layout, one button style and one footer to change - and so no screen
// hand-rolls HTML into sendEmail(). The operational emails that predate
// this (alerts, scheduled reports, the nightly backup) stay plain text on
// purpose: they go to people who asked for a machine's output, not to a
// client meeting Ankora for the first time.

/// Absolute origin for links that leave the app and land in someone's
/// inbox. The one rule that matters: a production email must never carry
/// a *.vercel.app address. Vercel's SSO protection on this project is set
/// to "all except custom domains", so every deployment URL - including
/// production's own immutable one - sits behind a Vercel login wall. A
/// recipient clicking such a link does not meet Ankora, they meet Vercel.
///
/// So in production the canonical domain wins outright and nothing can
/// override it into a protected host. Outside production VERCEL_URL is
/// still used, so a preview emails a preview link rather than reaching
/// into production data.
const VERCEL_HOST = /(^|\.)vercel\.app$/i;

function isProtectedHost(origin: string): boolean {
  try {
    return VERCEL_HOST.test(new URL(origin).hostname);
  } catch {
    return false;
  }
}

export function appBaseUrl(): string {
  const isProduction = process.env.VERCEL_ENV === "production";
  const configured = process.env.NEXTAUTH_URL?.trim().replace(/\/+$/, "");

  // An explicit value is honoured everywhere except when it would put a
  // protected host into a production email - the exact failure this
  // function exists to prevent, and one an env edit could reintroduce.
  if (configured && !(isProduction && isProtectedHost(configured))) return configured;
  if (isProduction) return SITE_URL;

  const vercel = process.env.VERCEL_URL?.trim().replace(/\/+$/, "");
  if (vercel) return `https://${vercel}`;
  return SITE_URL;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface ActionEmailInput {
  /// One line, the reason the message exists. Shown as the heading.
  title: string;
  /// One or two short paragraphs above the button.
  body: string[];
  buttonLabel: string;
  url: string;
  /// Expiry / "if you didn't expect this" line under the button.
  footnote?: string;
}

export interface RenderedEmail {
  html: string;
  text: string;
}

/// One transactional layout: navy header strip, cream card, gold button.
/// Table-based and inline-styled because that is the only thing every
/// mail client agrees on - this is not a place for the app's Tailwind
/// tokens, so the few hex values below are intentional duplicates of
/// `navy`, `paper`, `gold` and `cream` rather than a second palette.
export function renderActionEmail(input: ActionEmailInput): RenderedEmail {
  const paragraphs = input.body
    .map(
      (line) =>
        `<p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#1B2A3D;">${escapeHtml(line)}</p>`
    )
    .join("");

  const footnote = input.footnote
    ? `<p style="margin:22px 0 0;font-size:12.5px;line-height:1.6;color:rgba(27,42,61,.6);">${escapeHtml(
        input.footnote
      )}</p>`
    : "";

  const html = `<!doctype html>
<html dir="rtl" lang="he">
  <body style="margin:0;padding:0;background:#F8F4EC;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F8F4EC;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border:1px solid rgba(27,42,61,.12);border-radius:18px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
            <tr>
              <td style="background:#1B2A3D;padding:18px 24px;">
                <span style="font-size:14px;font-weight:600;letter-spacing:.18em;color:#F3EADB;">ANKORA</span>
              </td>
            </tr>
            <tr>
              <td style="padding:26px 24px 28px;" dir="rtl" align="right">
                <p style="margin:0 0 16px;font-size:20px;font-weight:500;color:#0B1B33;">${escapeHtml(
                  input.title
                )}</p>
                ${paragraphs}
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 0;">
                  <tr>
                    <td style="background:#B08D57;border-radius:999px;">
                      <a href="${escapeHtml(
                        input.url
                      )}" style="display:inline-block;padding:12px 26px;font-size:14.5px;color:#FFFFFF;text-decoration:none;">${escapeHtml(
    input.buttonLabel
  )}</a>
                    </td>
                  </tr>
                </table>
                ${footnote}
                <p style="margin:22px 0 0;font-size:11.5px;line-height:1.6;color:rgba(27,42,61,.45);word-break:break-all;">
                  אם הכפתור אינו עובד, אפשר להעתיק את הכתובת הזו לדפדפן:<br />${escapeHtml(input.url)}
                </p>
              </td>
            </tr>
            <tr>
              <td style="background:#F8F4EC;padding:14px 24px;font-size:11px;color:rgba(27,42,61,.5);">
                Ankora · אינטליגנציה תפעולית שמחזירה זמן
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [input.title, "", ...input.body, "", `${input.buttonLabel}: ${input.url}`, input.footnote ?? ""]
    .filter((line, i, all) => !(line === "" && all[i - 1] === ""))
    .join("\n")
    .trim();

  return { html, text };
}
