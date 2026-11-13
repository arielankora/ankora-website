// "סמן הודעות" (4.11.2026, task "מעקב: שיחה עם ANKORA"): several WhatsApp
// messages chosen by hand go into one task, new or existing. Hadas's case:
// the meetings she coordinates land in one "תיאום פגישות" task; Ariel's: a
// photo in one message and its explanation in the next belong together.
//
// Pure: parsing what the screen sends and writing the comment. No database
// and no Unipile, so it is unit-tested on its own
// (tests/unit/whatsapp-selected-messages.test.ts).

// Not imported from lib/timezone.ts: that module is server-only, and this
// one is also loaded in the browser by MessageSelection.tsx.
const TIMEZONE = "Asia/Jerusalem";

/// How many messages one save takes. A month of coordination is many
/// conversations, each saved on its own; a single save of more than this
/// is almost certainly "select all" by mistake.
export const MAX_SELECTED_MESSAGES = 30;
/// Images fetched and filed per save. Each costs two Unipile requests,
/// and the account has a daily quota (PR #375).
export const MAX_FILED_IMAGES = 5;

export type SelectedFile = { id: string; type: string; label: string };

export type SelectedMessage = {
  id: string;
  /// ISO timestamp, as the timeline has it.
  at: string;
  text: string;
  mine: boolean;
  senderName: string | null;
  files: SelectedFile[];
  /// A voice message's transcript, when it has one (4.11.2026, Ariel: the
  /// marked voice message reached the task without it).
  transcript?: string | null;
};

/// The word a file goes by inside the comment a task gets (formatSelectedMessages).
/// It is written into the task, so it is content and stays in Hebrew
/// (ADR 0006); the screen shows its own, translated word beside it.
const CONTENT_FILE_LABEL: Record<string, string> = {
  img: "תמונה",
  image: "תמונה",
  video: "וידאו",
  audio: "הודעה קולית",
  file: "קובץ",
  sticker: "מדבקה",
  contact_card: "איש קשר",
};

export function contentFileLabel(a: { type: string; voiceNote?: boolean }): string {
  if (a.voiceNote) return "הודעה קולית";
  return CONTENT_FILE_LABEL[a.type] ?? "קובץ";
}

/// A message's text as it goes into a task (13.11.2026): each contact card
/// it carries as a name and numbers. Content, so in Hebrew (ADR 0006).
export function contentText(m: { text: string; attachments: Array<{ contact?: { name: string | null; phones: string[] } | null }> }): string {
  const cards = m.attachments.flatMap((a) => (a.contact ? [`איש קשר: ${[a.contact.name, ...a.contact.phones].filter(Boolean).join(", ")}`] : []));
  return [m.text, ...cards].filter(Boolean).join("\n");
}

/// Per message. The comment as a whole is capped by MAX_COMMENT_LENGTH.
export const MAX_TRANSCRIPT_IN_COMMENT = 3000;

const IMAGE_TYPES = new Set(["img", "image"]);

export function isImageFile(f: Pick<SelectedFile, "type">): boolean {
  return IMAGE_TYPES.has(f.type);
}

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

/// What the screen sent, checked field by field. Anything malformed is
/// dropped rather than trusted; an empty result is refused by the caller.
export function parseSelectedMessages(raw: unknown): SelectedMessage[] {
  let data: unknown;
  try {
    data = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: SelectedMessage[] = [];
  const seen = new Set<string>();
  for (const item of data.slice(0, MAX_SELECTED_MESSAGES)) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const id = str(r.id, 200);
    const at = str(r.at, 40);
    if (!id || seen.has(id) || Number.isNaN(Date.parse(at))) continue;
    seen.add(id);
    const files = Array.isArray(r.files)
      ? r.files
          .slice(0, 10)
          .map((f) => (f && typeof f === "object" ? (f as Record<string, unknown>) : {}))
          .map((f) => ({ id: str(f.id, 200), type: str(f.type, 20), label: str(f.label, 40) }))
          .filter((f) => f.id && f.type)
      : [];
    out.push({
      id,
      at,
      text: str(r.text, 2000),
      mine: r.mine === true,
      senderName: str(r.senderName, 80) || null,
      files,
      transcript: str(r.transcript, MAX_TRANSCRIPT_IN_COMMENT).trim() || null,
    });
  }
  // The order they happened in, whatever order they were clicked in.
  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

const dayFormat = new Intl.DateTimeFormat("he-IL", { timeZone: TIMEZONE, day: "numeric", month: "numeric", year: "numeric" });
const timeFormat = new Intl.DateTimeFormat("he-IL", { timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit", hour12: false });

/// The comment, in the same plain markdown every comment uses. One header
/// line saying where it came from, then one line per message with its
/// time, who wrote it and what it said. A file is named, never linked:
/// the WhatsApp address of a file is not something a task should carry.
export function formatSelectedMessages(input: {
  contactName: string;
  phone: string | null;
  messages: SelectedMessage[];
  /// Images that were filed on the task, by message id, so the line can
  /// say so.
  filedImages?: Set<string>;
  maxLength: number;
}): string {
  const who = input.contactName.trim() || input.phone || "איש קשר";
  const days = [...new Set(input.messages.map((m) => dayFormat.format(new Date(m.at))))];
  const header = `**וואטסאפ · ${who}${input.phone && input.phone !== who ? ` · ${input.phone}` : ""} · ${days.join(", ")}**`;
  const lines = [header];
  for (const m of input.messages) {
    const author = m.mine ? "אנחנו" : m.senderName || who;
    const parts: string[] = [];
    if (m.text.trim()) parts.push(m.text.replace(/\s+/g, " ").trim());
    for (const f of m.files) {
      if (f.type === "audio") {
        parts.push(m.transcript ? `[${f.label || "הודעה קולית"}] תמלול: ${m.transcript.replace(/\s+/g, " ").trim()}` : `[${f.label || "הודעה קולית"}, לא תומללה]`);
        continue;
      }
      parts.push(
        isImageFile(f) && input.filedImages?.has(`${m.id}:${f.id}`) ? `[${f.label || "תמונה"}, תויקה במשימה]` : `[${f.label || "קובץ"}]`,
      );
    }
    if (parts.length === 0) parts.push("[הודעה שאינה טקסט]");
    lines.push(`- ${timeFormat.format(new Date(m.at))} ${author}: ${parts.join(" ")}`);
  }
  let body = lines.join("\n");
  if (body.length > input.maxLength) {
    const cut = "\n(קוצר: ההודעות ארוכות מדי להערה אחת)";
    body = body.slice(0, input.maxLength - cut.length) + cut;
  }
  return body;
}

/// The title a new task gets when the person did not write one.
export function proposeSelectedTitle(contactName: string, phone: string | null): string {
  return `מעקב: שיחה עם ${contactName.trim() || phone || "איש קשר"}`;
}

// Messages as steps (5.11.2026, option B on Claude Design, chosen by
// Ariel): each marked message is proposed as one step line, the person
// edits, unticks, reorders or adds lines in the dialog, and only the
// ticked lines are sent. The comment with the full messages stays.

/// Steps one save creates. The same cap as the MCP tools that add steps
/// (lib/mcp/task-extra-tools.ts), so a task gets no more lines from a
/// conversation than from any other single request.
export const MAX_STEPS_FROM_MESSAGES = 15;
/// A step is a task, and a task title is capped at 200 (createTask).
export const MAX_STEP_TITLE = 200;

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/// The line a message proposes as a step: its text, or a voice message's
/// transcript. Empty for a message with nothing to read (an image alone),
/// which the dialog shows unticked. Time and sender are left out: they
/// stay in the comment.
export function proposeStepText(m: Pick<SelectedMessage, "text" | "transcript">): string {
  const text = oneLine(m.text) || oneLine(m.transcript ?? "");
  return text.slice(0, MAX_STEP_TITLE);
}

/// What the dialog sent as steps: a JSON list of lines. Lines are made one
/// line each, empty ones dropped. More than the cap is refused by the
/// caller rather than cut here, so nobody loses a step without being told.
export function parseStepLines(raw: unknown): string[] {
  if (raw === null || raw === undefined || raw === "") return [];
  let data: unknown;
  try {
    data = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data
    .slice(0, MAX_STEPS_FROM_MESSAGES + 1)
    .filter((v): v is string => typeof v === "string")
    .map((v) => oneLine(v).slice(0, MAX_STEP_TITLE))
    .filter(Boolean);
}
