import type { TaskBlocker, TaskPriority, TaskStatus } from "@prisma/client";
import { HEBREW, type Outgoing, type OutgoingT } from "@/lib/i18n/outgoing";

// What somebody else did to your task, as one line in the reader's
// language (Hebrew until ADR 0006's outgoing channels).
//
// Ariel, 7.10.2026: the morning digest should include "משימה שנמצאת
// עליך ומישהו אחר עידכן אותה, ומה העידכון בדיוק". The audit log already
// holds every change with the row before and after it, so the digest
// reads the log instead of keeping a second record, and this module
// turns one log row into the sentence a person needs.
//
// Pure, and deliberately selective. A line is written only for a change
// that asks something of the person: a comment, a file, a new date, a
// status somebody else moved, a wait that started or ended. Category,
// the client-facing title, portal visibility and spelling fixes are
// real changes with nothing to do attached, and listing them is how a
// short email stops being read.

/// The longest quote of a comment in the digest.
export const COMMENT_QUOTE_CHARS = 160;

export type ChangeEvent = {
  action: string;
  before: unknown;
  after: unknown;
  /// For "task.comment": the comment's text, looked up by the caller.
  commentBody?: string | null;
  /// For "client_document.add": the file's title.
  fileTitle?: string | null;
};

function field(row: unknown, key: string): unknown {
  return row && typeof row === "object" ? (row as Record<string, unknown>)[key] : undefined;
}

export function formatShortDate(value: unknown, out: Outgoing = HEBREW): string {
  if (value === null || value === undefined || value === "") return out.t("changes.noDate");
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return out.t("changes.noDate");
  return new Intl.DateTimeFormat(out.tag, { day: "numeric", month: "numeric", timeZone: out.timeZone }).format(d);
}

export function quoteComment(text: string, max = COMMENT_QUOTE_CHARS): string {
  const flat = text
    .replace(/[*_`>#]/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

function statusLine(from: unknown, to: unknown, t: OutgoingT): string | null {
  const a = from as TaskStatus | undefined;
  const b = to as TaskStatus | undefined;
  if (!b || a === b) return null;
  // The two status moves that mean work came back, named as such.
  if (a === "PENDING_APPROVAL" && (b === "OPEN" || b === "IN_PROGRESS")) return t("changes.backFromApproval");
  if ((a === "DONE" || a === "ARCHIVED") && (b === "OPEN" || b === "IN_PROGRESS")) return t("changes.reopened");
  return t("changes.status", { from: a ? t(`labels.status.${a}`) : "?", to: t(`labels.status.${b}`) });
}

/// One line for one audit row, or null when it is not worth a line. In
/// the reader's language (ADR 0006, outgoing channels): the morning
/// digest passes its recipient's words.
export function describeChange(e: ChangeEvent, out: Outgoing = HEBREW): string | null {
  const { t } = out;
  switch (e.action) {
    case "task.comment":
      return e.commentBody ? t("changes.comment", { quote: quoteComment(e.commentBody) }) : null;
    case "client_document.add":
      return e.fileTitle ? t("changes.fileNamed", { title: e.fileTitle }) : t("changes.file");
    case "task.approve":
      return t("changes.approved");
    case "task.blocked": {
      const on = field(e.after, "blockedOn") as TaskBlocker | null | undefined;
      return on ? t(`labels.blocker.${on}`) : t("changes.blocked");
    }
    case "task.unblocked":
      return t("changes.unblocked");
    case "task.status_change":
    case "task.update": {
      const parts: string[] = [];
      const s = statusLine(field(e.before, "status"), field(e.after, "status"), t);
      if (s) parts.push(s);
      const pb = field(e.before, "priority") as TaskPriority | undefined;
      const pa = field(e.after, "priority") as TaskPriority | undefined;
      if (pa && pb !== pa) parts.push(t("changes.priority", { from: pb ? t(`labels.priority.${pb}`) : "?", to: t(`labels.priority.${pa}`) }));
      const db = field(e.before, "dueDate");
      const da = field(e.after, "dueDate");
      if (JSON.stringify(db ?? null) !== JSON.stringify(da ?? null)) {
        parts.push(t("changes.dueDate", { from: formatShortDate(db, out), to: formatShortDate(da, out) }));
      }
      const desB = field(e.before, "description");
      const desA = field(e.after, "description");
      if ((desB ?? null) !== (desA ?? null)) parts.push(desA ? t("changes.descriptionUpdated") : t("changes.descriptionRemoved"));
      return parts.length > 0 ? parts.join(" · ") : null;
    }
    default:
      return null;
  }
}
