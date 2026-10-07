// Pure, dependency-free text builder for the "תקציר פעילות ללקוח" tab on
// /app/reports (docs/adr/0001 section 19.14). No project imports, no
// "server-only", safe to unit-test in the sandbox - same convention as
// lib/csv.ts and lib/time-entry-format.ts.
//
// Ariel (2026-09-11): wants a per-client, per-period text block he can
// paste into ChatGPT/Claude, which then writes a short client-facing
// summary of what was done. This module does NOT summarize anything
// itself - it only assembles the raw activity data (plus an instruction
// preface) into one copy/download-ready string. Per Ariel's explicit
// choice, every entry in range is included (not just ones with a note),
// "כדי שיהיה ל-AI כמה שיותר אינפורמציה" (so the AI has as much
// information as possible).

export interface ActivityPromptEntry {
  /** Pre-formatted display date/time, e.g. "10.09.2026 18:16". */
  dateLabel: string;
  userName: string;
  categoryName: string;
  /** Pre-formatted duration, e.g. "0:24" or "פעיל" for a running timer. */
  durationLabel: string;
  /** Hebrew source label, e.g. "ידני" / "טיימר". */
  sourceLabel: string;
  note: string | null;
  /**
   * The task this entry was reported against, as the client would read
   * it: the task's `clientTitle` when it has one, otherwise its title.
   * Null for an entry with no task.
   */
  taskTitle?: string | null;
  /**
   * The task's internal title. Only used to recognise a note that is just
   * the task name pre-filled by the task screen's timer, so the same text
   * is not sent to the AI twice. Not printed.
   */
  taskInternalTitle?: string | null;
  isEdited?: boolean;
}

export interface ClientActivityPromptInput {
  clientName: string;
  /** Pre-formatted display dates, e.g. "01.09.2026". Both optional. */
  fromLabel?: string;
  toLabel?: string;
  entries: ActivityPromptEntry[];
  /** Pre-formatted sum of all entries' durations, e.g. "12:45". */
  totalDurationLabel: string;
}

function rangeLabel(fromLabel?: string, toLabel?: string): string {
  if (fromLabel && toLabel) return `בין ${fromLabel} ל-${toLabel}`;
  if (fromLabel) return `החל מ-${fromLabel}`;
  if (toLabel) return `עד ${toLabel}`;
  return "בכל התקופה הזמינה";
}

// 7.10.2026, Ariel. Time reported on a task reached this text only by
// accident: the task screen's timer pre-fills the note with the task
// title, so the name rode along inside `note`. A task chosen from the
// timer screen's picker, a task attached at the stop, or a note the
// employee rewrote all lost it, and the AI saw "תקשורת מול הלקוח | 0:11"
// with no way to know what the work was. The task is now its own field.
//
// Labelled fields ("משימה:", "הערה:") rather than a bare separator, so the
// model can tell what the work was from what was said about it.
function sameText(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  return a.trim() === b.trim();
}

function entryLine(e: ActivityPromptEntry): string {
  const parts = [e.dateLabel, e.userName, e.categoryName, e.durationLabel, e.sourceLabel];
  let line = parts.join(" | ");
  if (e.isEdited) line += " (נערך)";
  const task = e.taskTitle?.trim();
  if (task) line += ` | משימה: ${task}`;
  const note = e.note?.trim();
  // The pre-filled note is the task's internal title. Printing it again
  // after the task adds nothing, and when the task has a client-facing
  // title it would put the internal wording back in front of the AI.
  const noteIsTaskName = sameText(note, task) || sameText(note, e.taskInternalTitle);
  if (note && !(task && noteIsTaskName)) line += ` | הערה: ${note}`;
  return line;
}

export function buildClientActivityPrompt(input: ClientActivityPromptInput): string {
  const { clientName, fromLabel, toLabel, entries, totalDurationLabel } = input;

  const header = [
    `להלן פירוט מלא של כל הפעילויות שדווחו עבור הלקוח "${clientName}" ${rangeLabel(
      fromLabel,
      toLabel
    )} (${entries.length} דיווחים, סה"כ ${totalDurationLabel} שעות עבודה).`,
    `אנא כתוב סיכום קצר, ברור ומקצועי בעברית (2-4 פסקאות או תבליטים) של העבודה שבוצעה בתקופה זו, מתאים לשיתוף ישיר עם הלקוח.`,
    `קבץ פעילויות דומות יחד, השמט פרטים פנימיים שלא רלוונטיים ללקוח (כגון שם העובד הספציפי שביצע כל משימה או מקור הדיווח), ושמור על טון חיובי ומקצועי.`,
    `דיווחים עם אותה "משימה:" שייכים לאותה עבודה, גם כשהם בימים שונים. תאר כל משימה כפריט אחד לפי שמה, ולא כרשימת דיווחים נפרדים.`,
  ].join("\n");

  if (entries.length === 0) {
    return `${header}\n\n(לא נמצאו דיווחים בטווח שנבחר.)`;
  }

  const lines = entries.map(entryLine);
  return `${header}\n\n---\n\n${lines.join("\n")}\n\n---`;
}
