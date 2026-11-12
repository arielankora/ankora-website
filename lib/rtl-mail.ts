// A mail Ankora sends from a person's own mailbox (procedure send steps,
// the connection test), as a raw MIME message for Gmail's send API.
//
// 5.11.2026 (task cmvtivumj000pjs08q9qj4t67): the first test mail was plain
// text, and Gmail showed the Hebrew left to right, with the full stop at the
// start of the line. A client would see that as broken. So every message has
// an HTML part marked dir="rtl", and a plain-text part for clients that do
// not show HTML. Pure, so a test can read what leaves.
//
// 12.11.2026 (ADR 0006, part B): the direction follows the language of the
// text. A procedure step written in English goes out left to right, with
// lang="en"; Hebrew goes out exactly as before. The text itself is what
// the procedure says, never translated here.

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/// Header values never carry a line break: a newline in a recipient or a
/// subject would let it add headers of its own.
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

/// The direction of a text: right to left when its letters are mostly
/// Hebrew (or Arabic), left to right when they are mostly anything else.
/// Counted over letters, not the first one, so an English sentence that
/// opens with a Hebrew name, or the reverse, keeps its own direction.
/// Text with no letters at all keeps the Hebrew default.
export function textDirection(text: string): "rtl" | "ltr" {
  let rtl = 0;
  let ltr = 0;
  for (const ch of text) {
    if (/[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/.test(ch)) rtl++;
    else if (/\p{L}/u.test(ch)) ltr++;
  }
  return ltr > rtl ? "ltr" : "rtl";
}

export function rtlMimeMessage(input: { to: string; subject: string; text: string; boundary?: string; dir?: "rtl" | "ltr" }): string {
  const boundary = input.boundary ?? `ankora-${Date.now().toString(36)}`;
  const dir = input.dir ?? textDirection(input.text);
  const paragraphs = input.text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const html =
    dir === "rtl"
      ? `<!doctype html><html lang="he" dir="rtl"><body dir="rtl" style="direction:rtl;text-align:right;font-family:Arial,sans-serif;font-size:14px;line-height:1.6">${paragraphs}</body></html>`
      : `<!doctype html><html lang="en" dir="ltr"><body dir="ltr" style="direction:ltr;text-align:left;font-family:Arial,sans-serif;font-size:14px;line-height:1.6">${paragraphs}</body></html>`;
  return [
    `To: ${oneLine(input.to)}`,
    `Subject: =?UTF-8?B?${b64(oneLine(input.subject))}?=`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64(input.text),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64(html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}
