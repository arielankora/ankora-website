import { diffBlocks, diffParams } from "./diff";
import type { AgentBlock, AgentParam } from "./model";

// "נסח עם קלוד" (23.11.2026, "סוכנים באנקורה: אפיון"): a prompt, built from
// what changed between the approved version and the draft, that the person
// pastes into Claude to get the one-line change note. Nothing on the server
// calls a model: the person copies, Claude answers, the person pastes back.

export function changeNotePrompt(input: {
  agentName: string;
  before: { blocks: AgentBlock[]; params: AgentParam[]; actionLevel: string } | null;
  after: { blocks: AgentBlock[]; params: AgentParam[]; actionLevel: string };
}): string {
  const { before, after } = input;
  const blocks = diffBlocks(before?.blocks ?? [], after.blocks);
  const params = diffParams(before?.params ?? [], after.params);
  const lines: string[] = [];
  for (const c of blocks.changes) {
    const status = c.status === "added" ? "נוסף" : c.status === "removed" ? "הוסר" : "שונה";
    lines.push(`### ${c.title} (${status}${c.clientId ? ", תוספת ללקוח אחד" : ""})`);
    for (const l of c.lines) if (l.type !== "same") lines.push(`${l.type === "add" ? "+" : "-"} ${l.text}`);
    lines.push("");
  }
  const paramLine = [params.added.length ? `נוספו ${params.added.join(", ")}` : "", params.removed.length ? `הוסרו ${params.removed.join(", ")}` : "", params.changed.length ? `שונו ${params.changed.join(", ")}` : ""].filter(Boolean).join("; ");
  if (paramLine) lines.push(`פרמטרים: ${paramLine}`);
  if (before && before.actionLevel !== after.actionLevel) lines.push(`רמת הפעולה השתנתה מ-${before.actionLevel} ל-${after.actionLevel}.`);
  return [
    `כתוב שורה אחת בעברית פשוטה: מה השתנה בסוכן "${input.agentName}" ולמה. זו השורה שמי שמריץ את הסוכן יראה כשיציעו לו לעדכן.`,
    "בלי מקף ארוך או בינוני, בלי מונחים טכניים, עד 25 מילים. אם הסיבה לא ברורה מההבדלים, שאל אותי במקום לנחש.",
    "החזר רק את השורה.",
    "",
    "## ההבדלים מהגרסה שבשימוש",
    "",
    lines.length ? lines.join("\n") : "לא נמצאו הבדלים בקטעים או בפרמטרים.",
  ].join("\n");
}
