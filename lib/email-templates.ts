import "server-only";
import { SITE_URL } from "@/lib/site";

// Portal phase 0. Every transactional email the app sends to a PERSON
// (invite, sign-in link) is built here, so there is one Hebrew RTL
// layout, one button style and one footer to change - and so no screen
// hand-rolls HTML into sendEmail(). The operational emails that predate
// this (alerts, scheduled reports, the nightly backup) stay plain text on
// purpose: they go to people who asked for a machine's output, not to a
// client meeting Ankora for the first time.

/// Absolute origin for links that leave the app. NEXTAUTH_URL is what
/// Auth.js already trusts for callbacks and is set per environment in
/// Vercel; VERCEL_URL covers preview deployments that have no explicit
/// value; SITE_URL is the production fallback, and is deliberately last
/// so a preview never emails a link into production.
export function appBaseUrl(): string {
  const configured = process.env.NEXTAUTH_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/+$/, "")}`;
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
