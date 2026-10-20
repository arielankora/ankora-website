// Two names for the same thing (claude/org-brain-spec, "לא מכפילים").
//
// A meeting says "איילה", the file has "איילה מנצור". A document says
// "Washington DOR", the file has "Washington Department of Revenue".
// Without this the file ends with two people and two systems for one, and
// what is known about each is split between them.
//
// The rule is deliberately narrow, so that a hint is worth reading: one
// name's words are all in the other's (a first name and the full name),
// a short word in capitals stands for words in the other name (DOR), or
// a long word differs by one letter (a typo). A word is never matched
// inside another word: "אורן" is not "אורנה".

export type NameMatchKind = "SAME" | "PARTIAL";
export type NameCandidate = { id: string; name: string };
export type NameMatch = NameCandidate & { kind: NameMatchKind };

/// Lower case, no punctuation, no geresh or quotes, no Hebrew niqqud,
/// single spaces. "ג׳נאן" and "ג'נאן" and "גנאן" are one.
export function normalizeName(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[֑-ׇ]/g, "")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`"׳״]/g, "")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function nameTokens(s: string): string[] {
  const n = normalizeName(s);
  return n ? n.split(" ") : [];
}

/// Words that say nothing about which thing it is, left out of an
/// abbreviation: "Department of Revenue" is DOR.
const SMALL = new Set(["of", "the", "and", "for", "&", "של", "ו"]);

function oneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  // A typo only in a long word: short names differ by a letter on purpose.
  return a.length >= 6 && b.length >= 6 && oneEdit(a, b);
}

/// Each word of `short` is a word of `long`, or an abbreviation of a run
/// of its words. Every word of `long` is used at most once. null when it
/// is not covered; otherwise whether every word of `long` was used.
function covers(short: string[], long: string[]): { all: boolean } | null {
  const used = new Array(long.length).fill(false);
  for (const w of short) {
    const exact = long.findIndex((x, i) => !used[i] && sameWord(w, x));
    if (exact >= 0) {
      used[exact] = true;
      continue;
    }
    if (!/^[a-z]{2,5}$/.test(w)) return null;
    let found = false;
    for (let start = 0; start < long.length && !found; start++) {
      // DOR is Department Of Revenue; DR would be the same without "of".
      let all = "";
      let big = "";
      for (let end = start; end < long.length; end++) {
        if (used[end]) break;
        all += long[end][0];
        if (!SMALL.has(long[end])) big += long[end][0];
        if (end > start && (all === w || big === w)) {
          for (let k = start; k <= end; k++) used[k] = true;
          found = true;
          break;
        }
        if (!w.startsWith(all) && !w.startsWith(big)) break;
      }
    }
    if (!found) return null;
  }
  return { all: used.every(Boolean) };
}

/// SAME: the two are one name, written differently. PARTIAL: one is part
/// of the other. null: two names.
export function namesMatch(a: string, b: string): NameMatchKind | null {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.length || !tb.length) return null;
  if (ta.join(" ") === tb.join(" ")) return "SAME";
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const c = covers(short, long);
  if (!c) return null;
  return c.all ? "SAME" : "PARTIAL";
}

/// The candidates that may be the same as `name`, the closest first.
export function findNameMatches(name: string, candidates: NameCandidate[], limit = 3): NameMatch[] {
  const out: NameMatch[] = [];
  for (const c of candidates) {
    const kind = namesMatch(name, c.name);
    if (kind) out.push({ ...c, kind });
  }
  return out.sort((x, y) => (x.kind === y.kind ? 0 : x.kind === "SAME" ? -1 : 1)).slice(0, limit);
}

export type DuplicatePair<K extends string = string> = { kind: K; a: NameCandidate; b: NameCandidate; match: NameMatchKind };

/// Pairs inside one list of the same kind of item that may be one item:
/// the cleanup list on the client page.
export function duplicatePairs<K extends string>(kind: K, items: NameCandidate[]): DuplicatePair<K>[] {
  const out: DuplicatePair<K>[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const match = namesMatch(items[i].name, items[j].name);
      if (match) out.push({ kind, a: items[i], b: items[j], match });
    }
  }
  return out;
}
