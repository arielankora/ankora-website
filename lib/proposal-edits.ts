// What a person changed in a proposal before approving it, and whether
// the change was to the wording or to a fact (Ankora task
// cmw0yh420004qjz08bjnwmhej, 3.11.2026). Until now a proposal kept only
// `edited: true`, and approving overwrote the wording it came with, so a
// fixed typo and a fixed date looked the same.
//
// Pure, so the domain, the stats and the tests share one definition.
// The field names land on the proposal (`editedFields`); the values before
// and after stay in the audit row of the approval, which only managers read.

export type FieldEditKind = "WORDING" | "FACT";
export type ProposalEditKind = FieldEditKind | "MIXED";

export type FieldEdit = { field: string; before: unknown; after: unknown };

/// Never an edit: the sources travel with the proposal and are not typed.
const IGNORED = new Set(["sources"]);

/// What a field left out of the payload means, where that is not "nothing":
/// "not visible to the client" is what an item without the flag means.
const DEFAULTS: Record<string, unknown> = { clientVisible: false };

/// A string with its whitespace collapsed and trimmed; an empty one is no
/// value. Arrays are compared as sets (sorted by their canonical form),
/// since none of the payload's lists carries meaning in its order (emails,
/// phones, aliases, external refs). Objects compare by key, in any order.
export function canonicalValue(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") {
    const s = v.normalize("NFC").replace(/\s+/g, " ").trim();
    return s === "" ? null : s;
  }
  if (Array.isArray(v)) {
    const items = v.map(canonicalValue).filter((x) => x !== null);
    if (items.length === 0) return null;
    return items.map((x) => JSON.stringify(x)).sort().map((x) => JSON.parse(x));
  }
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const c = canonicalValue((v as Record<string, unknown>)[k]);
      if (c !== null) out[k] = c;
    }
    return Object.keys(out).length ? out : null;
  }
  return v;
}

function valueOf(payload: Record<string, unknown>, field: string): unknown {
  const v = payload[field];
  return v === undefined || v === null ? (DEFAULTS[field] ?? null) : v;
}

/// The fields whose value differs between the proposal as sent and as
/// approved, in the order of the field names. Values are returned as they
/// were (not normalized), for the audit row.
export function proposalEditDiff(before: Record<string, unknown>, after: Record<string, unknown>): FieldEdit[] {
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((f) => !IGNORED.has(f)).sort();
  const out: FieldEdit[] = [];
  for (const field of fields) {
    const b = valueOf(before, field);
    const a = valueOf(after, field);
    if (JSON.stringify(canonicalValue(b)) !== JSON.stringify(canonicalValue(a))) {
      out.push({ field, before: before[field] ?? null, after: after[field] ?? null });
    }
  }
  return out;
}

/// Free text, where a change can be only to how it is said. Every other
/// field (a name, a role, an email or phone, a kind or status, a date,
/// dayOfMonth, recurrence, an amount, validUntil, decidedAt, clientVisible,
/// a domain, a registration number...) holds a fact, so any change to it
/// is a FACT. An unknown field is a FACT too: the safe side.
export const WORDING_FIELDS: ReadonlySet<string> = new Set([
  "title",
  "body",
  "statement",
  "interimStatement",
  "handling",
  "notes",
  "purpose",
  "reason",
  "context",
  "blocker",
  "description",
  "toResolve",
  "triggerText",
]);

/// How close two texts must be (1 = the same) for the change to count as
/// wording. 0.6 lets through a reworded sentence and stops a new one.
export const WORDING_SIMILARITY = 0.6;

/// The numbers in a text (dates, amounts, times, counts), in order.
/// A text whose numbers changed changed a fact, however close it reads.
function numbersIn(s: string): string[] {
  return s.match(/\d+(?:[.,:/-]\d+)*/g) ?? [];
}

/// 1 minus the edit distance over the longer length. Long texts are
/// compared by words, so the cost stays small.
export function textSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const long = a.length > 2000 || b.length > 2000;
  const x = long ? a.split(" ") : [...a];
  const y = long ? b.split(" ") : [...b];
  const max = Math.max(x.length, y.length);
  if (max === 0) return 1;
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - prev[y.length] / max;
}

/// One changed field: WORDING only when the field is free text, it had a
/// text before and has one after (adding or clearing a text adds or
/// removes information), its numbers are the same, and the two texts are
/// close (WORDING_SIMILARITY, case aside). Anything else is a FACT.
export function classifyFieldEdit(field: string, before: unknown, after: unknown): FieldEditKind {
  if (!WORDING_FIELDS.has(field)) return "FACT";
  const b = canonicalValue(before);
  const a = canonicalValue(after);
  if (typeof b !== "string" || typeof a !== "string") return "FACT";
  if (JSON.stringify(numbersIn(b)) !== JSON.stringify(numbersIn(a))) return "FACT";
  return textSimilarity(b.toLowerCase(), a.toLowerCase()) >= WORDING_SIMILARITY ? "WORDING" : "FACT";
}

/// The kind of the whole edit: null when nothing changed, MIXED when some
/// fields changed in wording and others in fact.
export function proposalEditKind(kinds: FieldEditKind[]): ProposalEditKind | null {
  if (kinds.length === 0) return null;
  const set = new Set(kinds);
  return set.size > 1 ? "MIXED" : kinds[0];
}

/// The diff, each field classified, and the kind of the whole edit.
export function summarizeProposalEdit(before: Record<string, unknown>, after: Record<string, unknown>) {
  const diff = proposalEditDiff(before, after);
  const fieldKinds: Record<string, FieldEditKind> = {};
  for (const d of diff) fieldKinds[d.field] = classifyFieldEdit(d.field, d.before, d.after);
  return {
    editedFields: diff.map((d) => d.field),
    fieldKinds,
    editKind: proposalEditKind(Object.values(fieldKinds)),
    before: Object.fromEntries(diff.map((d) => [d.field, d.before])),
    after: Object.fromEntries(diff.map((d) => [d.field, d.after])),
  };
}

/// An editKind read back from an audit row, or null.
export function readEditKind(v: unknown): ProposalEditKind | null {
  return v === "WORDING" || v === "FACT" || v === "MIXED" ? v : null;
}
