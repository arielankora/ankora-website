// Tasks that an approved process already covers (21.10.2026).
//
// NUX had open tasks from 3.10, "מעקב חופשות, Leave ושינויים בהעסקה" and
// the like, written before the work became a process. Once P5 was
// approved, every run of it opens its own task, and the old one stays
// open beside it: the same work twice on Hadas's list.
//
// The match is deliberately narrow, so a suggestion is worth reading: most
// of the task's own words are in the process's title or purpose, at least
// two of them, and at least one in the title. Nothing is closed on its
// own: a manager reads the suggestion and decides.

import { nameTokens } from "@/lib/name-match";

/// Words that say nothing about which work it is.
const STOP = new Set([
  "של", "את", "על", "עם", "או", "גם", "כל", "לכל", "בלי", "אם", "כי", "זה", "זו", "הוא", "היא", "יש", "אין", "עד", "מול", "דרך", "לפי", "אחרי", "לפני", "בין", "כמו",
  "the", "and", "of", "for", "to", "a", "an", "in", "on", "with", "via",
]);

/// One letter in front that is a word of its own in Hebrew: "ושינויים",
/// "בהעסקה", "לשכר". Taken off once, and only from a long enough word.
const PREFIX = /^[והבלמשכ]/;

export function stem(word: string): string {
  return word.length >= 4 && PREFIX.test(word) && /[א-ת]/.test(word) ? word.slice(1) : word;
}

/// The words of a title that say what the work is.
export function contentWords(text: string): string[] {
  const out: string[] = [];
  for (const w of nameTokens(text)) {
    if (STOP.has(w) || w.length < 2 || /^\d+$/.test(w)) continue;
    if (!out.includes(w)) out.push(w);
  }
  return out;
}

function sharedPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

function closeForm(a: string, b: string): boolean {
  if (a === b) return true;
  const p = sharedPrefix(a, b);
  return p >= 4 && p >= 0.75 * Math.min(a.length, b.length);
}

/// The same word in another form: "דיווח" and "דיווחי", "ומעקב" and
/// "מעקב". A shared start of four letters that is most of the shorter,
/// with or without a one-letter prefix on either side.
export function sameForm(a: string, b: string): boolean {
  return closeForm(a, b) || closeForm(stem(a), b) || closeForm(a, stem(b)) || closeForm(stem(a), stem(b));
}

export type Overlap = { shared: string[]; share: number };

/// Whether the task is the process's work: null when it is not.
export function taskCoveredBy(task: { title: string }, process: { title: string; purpose?: string | null }): Overlap | null {
  const words = contentWords(task.title);
  if (words.length === 0) return null;
  const title = contentWords(process.title);
  const all = [...title, ...contentWords(process.purpose ?? "")];
  const shared = words.filter((w) => all.some((p) => sameForm(w, p)));
  const share = shared.length / words.length;
  if (shared.length < 2 || share < 0.6) return null;
  if (!shared.some((w) => title.some((p) => sameForm(w, p)))) return null;
  return { shared, share: Math.round(share * 100) / 100 };
}

export type OverlapTask = { id: string; title: string; status: string; processId: string | null; parentId: string | null };
export type OverlapProcess = { id: string; code: string; title: string; purpose?: string | null; status: string };

/// For each approved process, the open tasks of the same client it covers.
/// A run of a process, a step under a task and finished work are left out.
export function coveredTasks(processes: OverlapProcess[], tasks: OverlapTask[]): { processId: string; taskId: string; overlap: Overlap }[] {
  const open = tasks.filter((t) => !t.processId && !t.parentId && (t.status === "OPEN" || t.status === "IN_PROGRESS"));
  const out: { processId: string; taskId: string; overlap: Overlap }[] = [];
  for (const p of processes.filter((x) => x.status === "ACTIVE")) {
    for (const t of open) {
      const overlap = taskCoveredBy(t, p);
      if (overlap) out.push({ processId: p.id, taskId: t.id, overlap });
    }
  }
  return out;
}
