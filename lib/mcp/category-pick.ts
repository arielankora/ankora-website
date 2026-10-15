// Picking a category for a task nobody gave one (15.10.2026, Ariel).
//
// A task opened through Claude without a category could not be timed
// afterwards: a timer needs a category, and the person had to go back
// into the app and fill it in first. Ariel's call: when the user did not
// name one, Ankora picks the best fit itself, says which in the answer,
// and links the task so the user can change it in one click. No question
// back to the user - a category is a filing decision, cheap to correct,
// and asking for it on every task is exactly the friction Claude is
// there to remove.
//
// Pure on purpose, like lib/mcp/resolve.ts: no imports, so tests/unit
// runs it without a database. lib/mcp/lookup.ts supplies the candidates
// and the history, and is the only caller.

export type PickCandidate = { id: string; name: string; description?: string | null };

/// Something already filed under a category: an earlier task's title or a
/// time entry's note. The best evidence there is for where new work of
/// the same kind belongs, because it is how this team actually files.
export type PickHistory = { categoryId: string; text: string };

/// Why this category won, so the answer can say it in one line:
/// - title: the task's own words name the category
/// - similar: earlier work with similar words was filed there
/// - client-usage: nothing in the words decided it; it is what this
///   client's work is most often filed under
/// - default: no signal at all; the first category in the list
export type PickBasis = "title" | "similar" | "client-usage" | "default";

export type CategoryPick = {
  id: string;
  name: string;
  basis: PickBasis;
  /// The earlier item that tipped it, when basis is "similar".
  example?: string;
};

const HEBREW_FINALS: Record<string, string> = { ך: "כ", ם: "מ", ן: "נ", ף: "פ", ץ: "צ" };

// Words that appear in every kind of task and say nothing about which
// kind it is. Kept short: an over-eager list starts eating real signal.
const STOPWORDS = new Set([
  "על", "של", "את", "עם", "אל", "לא", "כל", "גם", "או", "אם", "זה", "זו", "מה", "יש", "אין", "עד",
  "לגבי", "בנושא", "צריך", "צריכה", "לבדוק", "בדיקה", "לטפל", "טיפול", "משימה", "חדש", "חדשה",
  "the", "a", "an", "of", "to", "and", "for", "in", "on", "with", "check", "task", "new",
]);

// One-letter Hebrew prefixes (ו, ה, ב, ל, מ, ש, כ). Stripped only from
// words long enough that what remains is still a word.
const PREFIXES = new Set(["ו", "ה", "ב", "ל", "מ", "ש", "כ"]);

/// The words of a text, each with its prefix-stripped form, normalised so
/// that "חשבונות", "והחשבונות" and "חשבון" can meet.
export function tokenize(text: string): string[][] {
  const clean = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[֑-ׇ]/g, "") // niqqud and cantillation
    .replace(/[ךםןףץ]/g, (ch) => HEBREW_FINALS[ch] ?? ch)
    .replace(/[^\p{L}\p{N}]+/gu, " ");
  const out: string[][] = [];
  const seen = new Set<string>();
  for (const word of clean.split(" ")) {
    if (word.length < 2 || STOPWORDS.has(word) || seen.has(word)) continue;
    seen.add(word);
    const forms = [word];
    if (word.length >= 4 && PREFIXES.has(word[0])) {
      forms.push(word.slice(1));
      if (word.length >= 5 && PREFIXES.has(word[1])) forms.push(word.slice(2));
    } else if (word.length >= 3 && word[0] === "ו" && /^[a-z]/.test(word.slice(1))) {
      forms.push(word.slice(1)); // "וhr"
    }
    out.push(forms);
  }
  return out;
}

function sharedPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

function formsMatch(a: string[], b: string[]): boolean {
  for (const x of a) {
    for (const y of b) {
      if (x === y) return true;
      // Same root, different ending: "חשבונית" / "חשבונות", "הזמנה" / "הזמנות".
      const p = sharedPrefix(x, y);
      if (p >= 4 && p >= 0.7 * Math.min(x.length, y.length)) return true;
    }
  }
  return false;
}

/// How many words of `text` find a partner in `other`.
function overlap(text: string[][], other: string[][]): number {
  let n = 0;
  for (const t of text) if (other.some((o) => formsMatch(t, o))) n++;
  return n;
}

/// The best category for a task, from its words, from how similar work
/// was filed before, and from what this client's work usually is.
///
/// Returns null only when there is nothing to choose from. Ties go to
/// the earlier candidate, so the admin's sort order decides the default.
export function pickCategory(input: {
  text: string;
  candidates: PickCandidate[];
  history?: PickHistory[];
  clientUsage?: Map<string, number>;
}): CategoryPick | null {
  const { candidates } = input;
  if (candidates.length === 0) return null;

  const words = tokenize(input.text);
  const usage = input.clientUsage ?? new Map<string, number>();
  const maxUsage = Math.max(0, ...usage.values());

  // History grouped by category, tokenised once.
  const byCategory = new Map<string, { text: string; tokens: string[][] }[]>();
  for (const h of input.history ?? []) {
    const list = byCategory.get(h.categoryId) ?? [];
    list.push({ text: h.text, tokens: tokenize(h.text) });
    byCategory.set(h.categoryId, list);
  }

  let best: { c: PickCandidate; total: number; name: number; similar: number; example?: string; usage: number } | null =
    null;

  for (const c of candidates) {
    // The category's own name is the strongest evidence; its description
    // is written by an admin to say what goes there, so it counts too.
    const name = words.length ? 5 * overlap(words, tokenize(c.name)) + 2 * overlap(words, tokenize(c.description ?? "")) : 0;

    // Earlier work: each item scores the share of its words the new task
    // shares, and the three closest count, so one category with a long
    // history does not win on volume alone.
    let similar = 0;
    let example: string | undefined;
    if (words.length) {
      const scored = (byCategory.get(c.id) ?? [])
        .map((h) => ({ text: h.text, s: h.tokens.length ? overlap(words, h.tokens) / Math.min(words.length, h.tokens.length) : 0 }))
        .filter((h) => h.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 3);
      similar = 3 * scored.reduce((sum, h) => sum + h.s, 0);
      example = scored[0]?.text;
    }

    // What this client's work usually is: a tie-breaker, never more than
    // one point, so it cannot outvote the task's own words.
    const used = usage.get(c.id) ?? 0;
    const prior = maxUsage > 0 ? Math.log1p(used) / Math.log1p(maxUsage) : 0;

    const total = name + similar + prior;
    if (!best || total > best.total) best = { c, total, name, similar, example, usage: used };
  }

  if (!best) return null;
  const { c } = best;
  if (best.name > 0) return { id: c.id, name: c.name, basis: "title" };
  if (best.similar > 0) return { id: c.id, name: c.name, basis: "similar", example: best.example };
  if (best.usage > 0) return { id: c.id, name: c.name, basis: "client-usage" };
  return { id: c.id, name: c.name, basis: "default" };
}

/// One line for the tool's answer, in English like the rest of the tool
/// surface; the model says it to the user in their language.
export function describePick(pick: CategoryPick): string {
  switch (pick.basis) {
    case "title":
      return `Chosen automatically: the task's wording matches "${pick.name}".`;
    case "similar":
      return `Chosen automatically: similar earlier work${pick.example ? ` ("${pick.example}")` : ""} was filed under "${pick.name}".`;
    case "client-usage":
      return `Chosen automatically: nothing in the wording decided it, so it is the category this client's work is most often filed under.`;
    default:
      return `Chosen automatically: nothing pointed to a specific category, so it is the first one in the list.`;
  }
}
