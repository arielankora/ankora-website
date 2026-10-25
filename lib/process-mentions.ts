// What a process already says without being linked (Ariel, 25.10.2026).
// P2 of NUX names the bank and Nextage in its steps, and still read
// "חסר: מערכות" and "חסר: גורם חיצוני": the gap counted only what was
// linked from the file, not what was written. Here a name of the file
// that appears in the process's own words is found, so the card can offer
// to link it in one click. Nothing is linked on its own. Pure.
//
// The match is narrow, as in lib/name-match.ts: every word of the name, in
// order, as whole words of the text. A Hebrew word may carry one prefix
// letter ("לבנק לאומי" names "בנק לאומי"). One short word is not enough.

import { nameTokens } from "@/lib/name-match";

export type Named = { id: string; name: string };

const PREFIX = /^[בלהומשכ]/;

function wordIs(textWord: string, nameWord: string, first: boolean): boolean {
  if (textWord === nameWord) return true;
  // One prefix letter, on the first word only, and only in Hebrew.
  return first && PREFIX.test(textWord) && textWord.slice(1) === nameWord && /[א-ת]/.test(nameWord);
}

function contains(text: string[], name: string[]): boolean {
  if (name.length === 0 || text.length < name.length) return false;
  for (let i = 0; i + name.length <= text.length; i++) {
    let ok = true;
    for (let j = 0; j < name.length && ok; j++) ok = wordIs(text[i + j], name[j], j === 0);
    if (ok) return true;
  }
  return false;
}

/// A name too short to tell anything apart: one word of under three
/// letters ("IT", "HR").
function tooShort(tokens: string[]): boolean {
  return tokens.length === 0 || (tokens.length === 1 && tokens[0].length < 3);
}

/// The items whose names appear in any of the texts, in their order.
export function mentionedIn<T extends Named>(texts: (string | null | undefined)[], items: T[]): T[] {
  const words = texts.filter((t): t is string => !!t?.trim()).map((t) => nameTokens(t));
  if (words.length === 0) return [];
  const out: T[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    if (seen.has(it.id)) continue;
    const name = nameTokens(it.name);
    if (tooShort(name)) continue;
    if (words.some((w) => contains(w, name))) {
      seen.add(it.id);
      out.push(it);
    }
  }
  return out;
}

/// The texts of a process that may name a system or a party: its steps,
/// what sets it off, who does it, who is outside, and the SLA.
export function processTexts(p: {
  triggerText?: string | null;
  executorText?: string | null;
  externalPartyText?: string | null;
  slaText?: string | null;
  approverText?: string | null;
  steps?: { title: string; output?: string | null }[];
}): string[] {
  return [p.triggerText, p.executorText, p.externalPartyText, p.slaText, p.approverText, ...(p.steps ?? []).flatMap((s) => [s.title, s.output ?? null])].filter(
    (x): x is string => !!x?.trim()
  );
}
