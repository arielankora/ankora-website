// A client mailbox's emails as the connector hands them to Claude
// (26.11.2026). Pure, no server-only and no Prisma, so
// tests/unit/client-mailbox-shape.test.ts runs it on Unipile's own shapes.
//
// Unipile's raw email carries every header and the HTML body; Claude needs
// who, when, what and which files, in Israel time, and the text once.

import type { RawAttachment, RawContact, RawEmail, RawFolder, RawPerson, RawSender, RawCategory } from "./unipile-mail";

/// One email's text in a read. A long thread is cut at THREAD_TEXT_CHARS
/// overall, so one call cannot cost more than a long document.
export const EMAIL_TEXT_CHARS = 20_000;
export const THREAD_TEXT_CHARS = 60_000;

const israel = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jerusalem",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/// "2026-11-14 09:05", Israel time.
export function israelTimeOf(iso: unknown): string | null {
  if (typeof iso !== "string" || !iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = Object.fromEntries(israel.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

/// "Dana Levi <dana@x.co>", or the bare address.
export function personOf(p: RawPerson): string | null {
  const email = str(p?.email);
  const name = str(p?.display_name);
  if (!email) return name;
  return name && name.toLowerCase() !== email.toLowerCase() ? `${name} <${email}>` : email;
}

function people(v: unknown): string[] {
  return Array.isArray(v) ? (v as RawPerson[]).map(personOf).filter((x): x is string => !!x) : [];
}

export type AttachmentView = { id: string; fileName: string | null; mimeType: string | null; sizeBytes: number | null; inline?: true; unavailable?: true };

export function attachmentsOf(v: unknown): AttachmentView[] {
  if (!Array.isArray(v)) return [];
  return (v as RawAttachment[]).flatMap((a) => {
    const id = str(a.id);
    if (!id) return [];
    return [
      {
        id,
        fileName: str(a.filename),
        mimeType: str(a.mimetype),
        sizeBytes: typeof a.file_size === "number" ? a.file_size : null,
        ...(a.is_inline === true ? { inline: true as const } : {}),
        ...(a.is_unavailable === true ? { unavailable: true as const } : {}),
      },
    ];
  });
}

export type EmailSummary = {
  id: string;
  threadId: string | null;
  at: string | null;
  from: string[];
  to: string[];
  cc: string[];
  subject: string;
  snippet: string;
  unread: boolean;
  folders: string[];
  categories?: string[];
  attachments: AttachmentView[];
};

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function summaryOf(e: RawEmail): EmailSummary | null {
  const id = str(e.id);
  if (!id) return null;
  const categories = strings(e.categories);
  return {
    id,
    threadId: str(e.thread_id),
    at: israelTimeOf(e.date),
    from: people(e.from),
    to: people(e.to),
    cc: people(e.cc),
    subject: str(e.subject) ?? "",
    snippet: (str(e.snippet) ?? "").slice(0, 300),
    unread: e.is_unread === true,
    folders: strings(e.folders),
    ...(categories.length ? { categories } : {}),
    // Inline images (logos, signatures) are noise in a list.
    attachments: attachmentsOf(e.attachments).filter((a) => !a.inline),
  };
}

/// HTML to readable text: enough to read an email, not to render it.
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function bodyTextOf(e: RawEmail): string {
  const plain = str(e.body_plain);
  if (plain) return plain.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const html = str(e.body);
  return html ? htmlToText(html) : "";
}

export type EmailFull = EmailSummary & { bcc: string[]; replyTo: string[]; text: string; textTruncated: boolean };

/// Each email's text, cut so the whole read stays under `budget`.
export function fullOf(emails: RawEmail[], budget = THREAD_TEXT_CHARS): EmailFull[] {
  let left = budget;
  const out: EmailFull[] = [];
  for (const e of emails) {
    const s = summaryOf(e);
    if (!s) continue;
    const body = bodyTextOf(e);
    const room = Math.max(0, Math.min(EMAIL_TEXT_CHARS, left));
    const text = body.slice(0, room);
    left -= text.length;
    out.push({
      ...s,
      bcc: people(e.bcc),
      replyTo: people(e.reply_to),
      text,
      textTruncated: text.length < body.length,
      // The full read lists inline files too: a scanned form can be one.
      attachments: attachmentsOf(e.attachments),
    });
  }
  return out;
}

export function folderOf(f: RawFolder) {
  const id = str(f.id);
  if (!id) return null;
  return {
    id,
    name: str(f.name) ?? id,
    ...(str(f.role) ? { role: str(f.role) } : {}),
    ...(str(f.parent_id) ? { parentId: str(f.parent_id) } : {}),
    ...(typeof f.unread_count === "number" ? { unread: f.unread_count } : {}),
    ...(typeof f.total_count === "number" ? { total: f.total_count } : {}),
    ...(f.is_system === true ? { system: true } : {}),
  };
}

export function senderOf(s: RawSender) {
  const email = str(s.email);
  if (!email) return null;
  return { email, name: str(s.display_name), ...(s.is_default === true ? { default: true } : {}), ...(s.is_primary === true ? { primary: true } : {}) };
}

function contactValues(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x) => {
    if (typeof x === "string") return [x];
    const o = x as { address?: unknown; value?: unknown; number?: unknown; email?: unknown } | null;
    const s = str(o?.address) ?? str(o?.value) ?? str(o?.number) ?? str(o?.email);
    return s ? [s] : [];
  });
}

export function contactOf(c: RawContact) {
  const id = str(c.id);
  const name = str(c.display_name) ?? ([str(c.first_name), str(c.last_name)].filter(Boolean).join(" ") || null);
  const emails = contactValues(c.emails);
  const phones = contactValues(c.phone_numbers);
  if (!id && !name && emails.length === 0) return null;
  return {
    name,
    emails,
    ...(phones.length ? { phones } : {}),
    ...(str(c.company_name) ? { company: str(c.company_name) } : {}),
    ...(str(c.job_title) ? { jobTitle: str(c.job_title) } : {}),
  };
}

export function categoryOf(c: RawCategory) {
  const name = str(c.name) ?? str(c.display_name);
  return name ? { name, ...(str(c.color) ? { color: str(c.color) } : {}) } : null;
}
