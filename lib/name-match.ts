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

// ---------------------------------------------------------------------------
// Dates (21.10.2026). Two rows for one birthday: "יום הולדת של אורן מירון
// (ברכה בקבוצה ו-BuyMe 100 ₪)" and "יום הולדת של אורן מירון (לידה
// 26.10.1991)", from two meetings. The titles differ only in what is in
// brackets, and both fall on the same day. A date is one date only when
// both hold: "תשלום ספקים (ה-10)" and "תשלום ספקים (ה-25)" share a title
// and are two dates.
// ---------------------------------------------------------------------------

/// When a date occurs, as far as two dates can be compared. `next` is the
/// next occurrence (YYYY-MM-DD) when it is known: the surest key, whatever
/// the calendar.
export type DateKey = {
  recurrence: string;
  calendarType?: string | null;
  month?: number | null;
  day?: number | null;
  weekday?: number | null;
  /// ONCE: the day itself, YYYY-MM-DD.
  once?: string | null;
  next?: string | null;
};

export type DateCandidate = { id: string; name: string; key: DateKey };

/// The title without what is in brackets: what the date is, not the notes
/// a meeting added to it.
export function dateCore(title: string): string {
  const core = title.replace(/\([^)]*\)/g, " ").replace(/\[[^\]]*\]/g, " ");
  return normalizeName(core) ? core : title;
}

/// Both fall on the same day, by the same rule.
export function sameSchedule(a: DateKey, b: DateKey): boolean {
  if (a.next && b.next) return a.next === b.next;
  const greg = (k: DateKey) => !k.calendarType || k.calendarType === "GREGORIAN";
  if (!greg(a) || !greg(b)) return false;
  if (a.recurrence !== b.recurrence) return false;
  switch (a.recurrence) {
    case "ONCE":
      return !!a.once && a.once === b.once;
    case "ANNUAL":
      return a.month != null && a.month === b.month && a.day != null && a.day === b.day;
    case "MONTHLY":
      return a.day != null && a.day === b.day;
    case "WEEKLY":
      return a.weekday != null && a.weekday === b.weekday;
    default:
      return false;
  }
}

/// SAME or PARTIAL when the two may be one date; null otherwise.
export function datesMatch(a: { name: string; key: DateKey }, b: { name: string; key: DateKey }): NameMatchKind | null {
  if (!sameSchedule(a.key, b.key)) return null;
  return namesMatch(dateCore(a.name), dateCore(b.name));
}

export function findDateMatches(date: { name: string; key: DateKey }, candidates: DateCandidate[], limit = 3): NameMatch[] {
  const out: NameMatch[] = [];
  for (const c of candidates) {
    const kind = datesMatch(date, c);
    if (kind) out.push({ id: c.id, name: c.name, kind });
  }
  return out.sort((x, y) => (x.kind === y.kind ? 0 : x.kind === "SAME" ? -1 : 1)).slice(0, limit);
}

export function dateDuplicatePairs<K extends string>(kind: K, items: DateCandidate[]): DuplicatePair<K>[] {
  const out: DuplicatePair<K>[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const match = datesMatch(items[i], items[j]);
      if (match) out.push({ kind, a: { id: items[i].id, name: items[i].name }, b: { id: items[j].id, name: items[j].name }, match });
    }
  }
  return out;
}

const ymdOf = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

/// A stored date (ImportantDate) as a key.
export function dateKeyFromRow(r: { recurrence: string; calendarType?: string | null; month: number; day: number; weekday?: number | null; onceDate?: Date | null; nextOccurrenceAt?: Date | null }): DateKey {
  return {
    recurrence: r.recurrence,
    calendarType: r.calendarType ?? "GREGORIAN",
    month: r.month,
    day: r.day,
    weekday: r.weekday ?? null,
    once: ymdOf(r.onceDate),
    next: ymdOf(r.nextOccurrenceAt),
  };
}
