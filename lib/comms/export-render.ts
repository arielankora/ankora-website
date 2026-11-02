// The communications export of one client (2.11.2026, spec "שמירת שיחות,
// הקלטות ותמלולים": "בסיום ההתקשרות הלקוח יכול לקבל ייצוא בתוך 30 יום,
// ואחר כך הכל נמחק"). Pure rendering, so it is covered by unit tests; the
// data is gathered in lib/comms/export.ts.
//
// One Markdown file: every WhatsApp conversation with the client's people
// and groups, message by message, and every recorded call with its
// transcript. Audio is not inside: the file says how many recordings there
// are, and they are sent separately if the client asks.

export type ExportMessage = { at: Date; fromUs: boolean; sender: string | null; text: string; attachments: string[] };
export type ExportConversation = { name: string; phone: string | null; isGroup: boolean; messages: ExportMessage[] };
export type ExportCall = { at: Date; direction: "IN" | "OUT" | "UNKNOWN"; phone: string; durationSec: number | null; transcript: string | null };

export type CommsExport = {
  clientName: string;
  generatedAt: Date;
  /// When the 30-day window ends and everything is deleted; null for a
  /// client that is still active.
  deletesOn: Date | null;
  conversations: ExportConversation[];
  calls: ExportCall[];
};

const when = new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Jerusalem" });
const day = new Intl.DateTimeFormat("he-IL", { dateStyle: "long", timeZone: "Asia/Jerusalem" });
const DIRECTION = { IN: "שיחה נכנסת", OUT: "שיחה יוצאת", UNKNOWN: "שיחה" } as const;

/// Markdown structure characters at the start of a line are escaped, so a
/// message cannot turn into a heading or a list in the file.
function line(text: string): string {
  return text.replace(/\r/g, "").replace(/^([#>*\-+|]|\d+\.)/gm, "\\$1");
}

function duration(sec: number | null): string {
  if (!sec || sec <= 0) return "";
  return ` (${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")})`;
}

export function renderCommsExport(data: CommsExport): string {
  const out: string[] = [];
  out.push(`# שיחות והקלטות: ${line(data.clientName)}`, "");
  out.push(`הופק ב-${when.format(data.generatedAt)} על ידי אנקורה.`);
  if (data.deletesOn) out.push(`ההתקשרות הסתיימה. כל השיחות וההקלטות יימחקו אצלנו ב-${day.format(data.deletesOn)}.`);
  out.push(
    "",
    `בקובץ: ${data.conversations.length} שיחות WhatsApp, ${data.calls.length} שיחות טלפון מוקלטות. קובצי השמע לא בתוך הקובץ, ואפשר לבקש אותם בנפרד.`,
    "",
  );

  out.push("## WhatsApp", "");
  if (data.conversations.length === 0) out.push("אין שיחות.", "");
  for (const c of data.conversations) {
    out.push(`### ${line(c.name)}${c.isGroup ? " (קבוצה)" : c.phone ? ` (${c.phone})` : ""}`, "");
    if (c.messages.length === 0) out.push("אין הודעות שמורות.", "");
    for (const m of c.messages) {
      const who = m.fromUs ? "אנקורה" : m.sender || c.name;
      const files = m.attachments.length ? ` [${m.attachments.join(", ")}]` : "";
      out.push(`**${when.format(m.at)}, ${line(who)}:** ${line(m.text)}${files}`, "");
    }
  }

  out.push("## שיחות טלפון", "");
  if (data.calls.length === 0) out.push("אין הקלטות.", "");
  for (const call of data.calls) {
    out.push(`### ${DIRECTION[call.direction]}, ${call.phone}, ${when.format(call.at)}${duration(call.durationSec)}`, "");
    out.push(call.transcript ? line(call.transcript) : "אין תמלול.", "");
  }
  return out.join("\n");
}
