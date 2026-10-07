import type { TaskBlocker, TaskPriority, TaskStatus } from "@prisma/client";
import { TASK_BLOCKER_LABELS } from "@/lib/app-domain/portal-labels";
import { TIMEZONE } from "@/lib/timezone";
import { TASK_PRIORITY_LABELS, TASK_STATUS_LABELS } from "@/lib/app-domain/tasks";

// What somebody else did to your task, as one line of Hebrew.
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

const STATUS = TASK_STATUS_LABELS;
const PRIORITY = TASK_PRIORITY_LABELS;

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

export function formatShortDate(value: unknown): string {
  if (value === null || value === undefined || value === "") return "ללא";
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return "ללא";
  return new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric", timeZone: TIMEZONE }).format(d);
}

export function quoteComment(text: string, max = COMMENT_QUOTE_CHARS): string {
  const flat = text
    .replace(/[*_`>#]/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

function statusLine(from: unknown, to: unknown): string | null {
  const a = from as TaskStatus | undefined;
  const b = to as TaskStatus | undefined;
  if (!b || a === b) return null;
  // The two status moves that mean work came back, named as such.
  if (a === "PENDING_APPROVAL" && (b === "OPEN" || b === "IN_PROGRESS")) return "הוחזרה מאישור";
  if ((a === "DONE" || a === "ARCHIVED") && (b === "OPEN" || b === "IN_PROGRESS")) return "נפתחה מחדש";
  return `סטטוס: ${a ? STATUS[a] : "?"} ← ${STATUS[b]}`;
}

/// One line for one audit row, or null when it is not worth a line.
export function describeChange(e: ChangeEvent): string | null {
  switch (e.action) {
    case "task.comment":
      return e.commentBody ? `תגובה: «${quoteComment(e.commentBody)}»` : null;
    case "client_document.add":
      return e.fileTitle ? `צירף/ה קובץ: ${e.fileTitle}` : "צירף/ה קובץ";
    case "task.approve":
      return "המשימה אושרה";
    case "task.blocked": {
      const on = field(e.after, "blockedOn") as TaskBlocker | null | undefined;
      return on ? TASK_BLOCKER_LABELS[on] : "סומנה כממתינה";
    }
    case "task.unblocked":
      return "ההמתנה הסתיימה";
    case "task.status_change":
    case "task.update": {
      const parts: string[] = [];
      const s = statusLine(field(e.before, "status"), field(e.after, "status"));
      if (s) parts.push(s);
      const pb = field(e.before, "priority") as TaskPriority | undefined;
      const pa = field(e.after, "priority") as TaskPriority | undefined;
      if (pa && pb !== pa) parts.push(`עדיפות: ${pb ? PRIORITY[pb] : "?"} ← ${PRIORITY[pa]}`);
      const db = field(e.before, "dueDate");
      const da = field(e.after, "dueDate");
      if (JSON.stringify(db ?? null) !== JSON.stringify(da ?? null)) {
        parts.push(`תאריך יעד: ${formatShortDate(db)} ← ${formatShortDate(da)}`);
      }
      const desB = field(e.before, "description");
      const desA = field(e.after, "description");
      if ((desB ?? null) !== (desA ?? null)) parts.push(desA ? "התיאור עודכן" : "התיאור הוסר");
      return parts.length > 0 ? parts.join(" · ") : null;
    }
    default:
      return null;
  }
}
