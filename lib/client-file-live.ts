// The client file as Claude reads it while working: a short brief for a
// small question, and what changed since a moment, for a long session or
// a scheduled run (claude/client-file-live-2026-10-20.md). Pure: both are
// cut from the same document the full file is (buildClientFile, "ai"), so
// nothing a person may not send to Claude can appear here either.

import { itemLine, type ClientFileDoc, type DocItem, type DocSection } from "@/lib/client-file-document";

const MAX_DAYS = 90;
const DEFAULT_DAYS = 7;
const DAY = 86_400_000;

/// "2026-10-13" or a full ISO time; nothing means a week. Never more than
/// 90 days: past that, read the whole file.
export function readSince(value: string | null | undefined, now: Date): { since: Date } | { error: string } {
  const v = value?.trim();
  if (!v) return { since: new Date(now.getTime() - DEFAULT_DAYS * DAY) };
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : v);
  if (Number.isNaN(d.getTime())) return { error: `"${v}" is not a date. Pass YYYY-MM-DD or an ISO time.` };
  if (d.getTime() > now.getTime()) return { error: "since is in the future." };
  if (now.getTime() - d.getTime() > MAX_DAYS * DAY) return { error: `More than ${MAX_DAYS} days: read the whole file with get_client_file instead.` };
  return { since: d };
}

const oneLine = (s: string) => s.replace(/\s*\n+\s*/g, " ");

function sectionLines(section: DocSection, items: DocItem[], line: (i: DocItem) => string): string[] {
  const out = ["", `## ${section.number ? `${section.number}. ` : ""}${section.title}`, ""];
  for (const i of items) out.push(`- ${oneLine(line(i))}`);
  return out;
}

/// The brief: who the client is, the rules to follow, how to talk to them,
/// what is temporary, what is open; the rest by name only. Enough to
/// answer a small question or draft a short message safely; anything
/// deeper reads the whole file.
const FULL = ["1", "4", "5", "6", "8", "9", "11", "13", "14"];
const NAMES_ONLY = ["3", "7.1", "7.2", "7.4"];
const FIRST_OF = { "10": 8 } as Record<string, number>;

export function briefMarkdown(doc: ClientFileDoc): string {
  const out = [`# תקציר תיק: ${doc.clientName}`, "", "תקציר לשאלה קצרה או להודעה קצרה. לעבודה מעמיקה, לתהליך או לניסוח מורכב: get_client_file."];
  if (doc.control?.length) out.push("", `**בקרה:** ${doc.control.map((p) => p.text).join(" · ")}`);
  for (const s of doc.sections) {
    if (!s.items.length) continue;
    if (FULL.includes(s.number)) out.push(...sectionLines(s, s.items, (i) => itemLine(i, true)));
    else if (NAMES_ONLY.includes(s.number)) out.push(...sectionLines(s, s.items, (i) => `${i.text.trim()}${i.ref ? ` (id: ${i.ref})` : ""}`));
    else if (FIRST_OF[s.number]) out.push(...sectionLines(s, s.items.slice(0, FIRST_OF[s.number]), (i) => itemLine(i, true)));
  }
  // "Do not tell" travels with the brief wherever it is, since the brief
  // is what a message gets drafted from.
  const secrets = doc.sections.flatMap((s) => (FULL.includes(s.number) ? [] : s.items.filter((i) => i.doNotDisclose)));
  if (secrets.length) out.push("", "## לא לספר", "", ...secrets.map((i) => `- ${oneLine(i.text)}: ${oneLine(i.doNotDisclose!)}`));
  out.push("");
  return out.join("\n");
}

export type RemovedItem = { label: string; text: string; how: "removed" | "replaced" | "retired" };
const HOW = { removed: "הוסר", replaced: "הוחלף בגרסה חדשה", retired: "בוטל" } as const;

/// What changed since: the items whose row changed, in their sections and
/// as they are now; and what left the file. Section 2 (the narratives)
/// comes whole when one of its texts changed.
export function changesMarkdown(doc: ClientFileDoc, input: { since: Date; changed: Set<string>; narrativesChanged: boolean; removed: RemovedItem[]; now: Date }): string {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const out = [`# מה השתנה בתיק: ${doc.clientName}`, "", `מ-${day(input.since)} עד ${day(input.now)}. כל פריט כתוב כמו שהוא עכשיו. מה שלא מופיע כאן לא השתנה.`];
  let count = 0;
  for (const s of doc.sections) {
    const items = s.number === "2" && input.narrativesChanged ? s.items : s.items.filter((i) => i.ref && input.changed.has(i.ref));
    if (!items.length) continue;
    count += items.length;
    out.push(...sectionLines(s, items, (i) => itemLine(i, true)));
  }
  if (input.removed.length) {
    count += input.removed.length;
    out.push("", "## יצא מהתיק", "", ...input.removed.map((r) => `- ${r.label}: ${oneLine(r.text)} (${HOW[r.how]})`));
  }
  if (!count) out.push("", "לא השתנה כלום בתקופה הזו.");
  if (doc.legend.length && count) {
    out.push("", "## מקרא מקורות", "", ...doc.legend.map((s) => `- **${s.code}**: ${oneLine(s.title)}`));
  }
  out.push("");
  return out.join("\n");
}
