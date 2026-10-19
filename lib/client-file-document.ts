// The client file as one document, in the order of Hadas's file
// (claude/org-brain-spec-2026-10-12.md, 6.1). Pure: the domain gathers
// the data, this shapes it, and the same shape is drawn by the read view
// and written out as Markdown for the export and for Claude.
//
// Every item carries its own trust: a status that is not "confirmed" is
// written next to it with what would close it, and its sources are
// written after it in Hadas's notation, "[S1 08:13]". A reader never has
// to look anywhere else to know how far to rely on a line.

import { KNOWLEDGE_STATUS_LABELS, type KnowledgeStatusLike } from "@/lib/knowledge";

export type DocItem = {
  /// The line itself.
  text: string;
  /// Secondary details, joined with " · ".
  details?: (string | null | undefined)[];
  status?: KnowledgeStatusLike;
  toResolve?: string | null;
  sources?: string[];
  doNotDisclose?: string | null;
  /// Spec 3.1: shown to the client in the portal, and who keeps it right.
  clientVisible?: boolean;
  owner?: string | null;
  /// Spec 3.1: where it lives in the team's other registers ("RAID-002").
  refs?: string[];
  /// The item's id, printed in Claude's version only, so a proposal can
  /// name the item it changes (action SUPERSEDE, targetId).
  ref?: string;
};

export type DocSection = {
  /// "1", "7.2", or "" for the unnumbered ones.
  number: string;
  title: string;
  /// Optional sub-groups (preferences by topic). Items without a group
  /// come first.
  items: (DocItem & { group?: string })[];
  /// What to write when there is nothing, so a reader can tell "nothing
  /// known" from "section forgotten".
  empty: string;
};

export type ClientFileDoc = {
  clientName: string;
  generatedAt: Date;
  /// "staff": everything this person may see. "ai": no contact details and
  /// nothing sensitive (spec 6.3).
  audience: "staff" | "ai";
  sections: DocSection[];
  /// The control line (spec 7.6), in parts. Absent in older callers.
  control?: { text: string; warn: boolean }[];
  legend: { code: string; title: string; details: string }[];
};

export const HOW_TO_READ =
  'כל שורה מסומנת לפי מה שידוע עליה. בלי סימון: מאושר, הלקוח או ספק שלו אמר או הראה במפורש. "לא ודאי" ו"חסר" מופיעים ליד הפריט, עם מה שיסגור אותו. המקורות כתובים בסוגריים, למשל [S1 08:13], ומוסברים במקרא בסוף.';

function statusNote(item: DocItem): string | null {
  if (!item.status || item.status === "CONFIRMED") return null;
  const label = KNOWLEDGE_STATUS_LABELS[item.status];
  return item.toResolve ? `${label}: ${item.toResolve}` : label;
}

/// One item as plain text, the way it is written in Markdown and read
/// aloud: the line, its details, its status, its sources.
export function itemLine(item: DocItem, withRef = false): string {
  const parts = [item.text.trim()];
  const details = (item.details ?? []).filter((d): d is string => !!d && !!d.trim());
  if (details.length) parts.push(`(${details.join(" · ")})`);
  const status = statusNote(item);
  if (status) parts.push(`**${status}**`);
  if (item.doNotDisclose) parts.push(`**לא לספר: ${item.doNotDisclose}**`);
  const kept = [item.clientVisible ? "גלוי ללקוח" : null, item.owner ? `בעלים: ${item.owner}` : null, item.refs?.length ? `הפניות: ${item.refs.join(", ")}` : null].filter(Boolean);
  if (kept.length) parts.push(`{${kept.join(" · ")}}`);
  if (item.sources?.length) parts.push(`[${item.sources.join(", ")}]`);
  if (withRef && item.ref) parts.push(`(id: ${item.ref})`);
  return parts.join(" ");
}

function dateLabel(d: Date): string {
  return new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric", year: "numeric", timeZone: "Asia/Jerusalem" }).format(d);
}

/// Line breaks inside a single item would break the list; they become
/// spaces. Nothing else is touched: this is text for people and for
/// Claude, not HTML.
function oneLine(s: string): string {
  return s.replace(/\s*\n+\s*/g, " ");
}

export function toMarkdown(doc: ClientFileDoc): string {
  const out: string[] = [];
  out.push(`# תיק לקוח: ${doc.clientName}`);
  out.push("");
  out.push(`הופק ב-${dateLabel(doc.generatedAt)}${doc.audience === "ai" ? ". גרסה ל-Claude: בלי פרטי קשר ובלי פריטים רגישים." : "."}`);
  if (doc.control?.length) {
    out.push("");
    out.push(`**בקרה:** ${doc.control.map((p) => p.text).join(" · ")}`);
  }
  out.push("");
  out.push("## איך לקרוא את התיק");
  out.push("");
  out.push(HOW_TO_READ);
  for (const section of doc.sections) {
    out.push("");
    out.push(`## ${section.number ? `${section.number}. ` : ""}${section.title}`);
    out.push("");
    if (section.items.length === 0) {
      out.push(section.empty);
      continue;
    }
    const ungrouped = section.items.filter((i) => !i.group);
    const groups = [...new Set(section.items.filter((i) => i.group).map((i) => i.group!))];
    for (const item of ungrouped) out.push(`- ${oneLine(itemLine(item, doc.audience === "ai"))}`);
    for (const g of groups) {
      if (ungrouped.length || groups.length > 1) {
        out.push("");
        out.push(`### ${g}`);
        out.push("");
      }
      for (const item of section.items.filter((i) => i.group === g)) out.push(`- ${oneLine(itemLine(item, doc.audience === "ai"))}`);
    }
  }
  out.push("");
  out.push("## מקרא מקורות");
  out.push("");
  if (doc.legend.length === 0) out.push("אין עדיין מקורות במרשם.");
  for (const s of doc.legend) out.push(`- **${s.code}**: ${oneLine(s.title)}${s.details ? ` (${s.details})` : ""}`);
  out.push("");
  return out.join("\n");
}
