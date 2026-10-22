// Sources: where each item in a client's file came from
// (claude/org-brain-spec-2026-10-12.md, sections 1.6, 3.1, 3.2 and rules
// R14 and R17). Pure: no Prisma, so the rules are testable anywhere and a
// client component may import the labels.
//
// A source is a code in the client's own register (S1, S2...), plus the
// minute when it is a recording. The rules that live here:
//
// 1. **Every item has a source**, except one marked "missing": a missing
//    item is, by definition, something nobody has told us yet.
// 2. **A source must exist** in the register. A code that does not is
//    refused, in a form field and inside free text ("[S9 08:13]").
// 3. **Ankora's own writing never confirms anything** (R14). An item
//    whose sources are all secondary is lowered to "uncertain", with what
//    would confirm it.

import type { KnowledgeStatusLike } from "@/lib/knowledge";

export type SourceKindLike = "TRANSCRIPT" | "CLIENT_DOCUMENT" | "TASK" | "PERSON" | "ANKORA_DOCUMENT";
export type SourceWeightLike = "PRIMARY" | "SECONDARY";
export type SourceRestrictionLike = "NONE" | "TOPICS_ONLY";

export const SOURCE_KIND_LABELS: Record<SourceKindLike, string> = {
  TRANSCRIPT: "הקלטה",
  CLIENT_DOCUMENT: "מסמך של הלקוח",
  TASK: "משימה",
  PERSON: "נמסר בעל פה",
  ANKORA_DOCUMENT: "מסמך של אנקורה",
};

export const SOURCE_WEIGHT_LABELS: Record<SourceWeightLike, string> = {
  PRIMARY: "ראשוני",
  SECONDARY: "משני",
};

export const SOURCE_RESTRICTION_LABELS: Record<SourceRestrictionLike, string> = {
  NONE: "ללא הגבלה",
  TOPICS_ONLY: "נושאים בלבד",
};

/// Ankora's own documents are secondary by nature; everything else starts
/// as primary. The person adding the source may still change it.
export function defaultWeight(kind: SourceKindLike): SourceWeightLike {
  return kind === "ANKORA_DOCUMENT" ? "SECONDARY" : "PRIMARY";
}

export type SourceRef = { code: string; at?: string };

export function sourceCode(seq: number): string {
  return `S${seq}`;
}

/// "8:13", "08:13" and "1:02:03" are minutes into a recording; anything
/// else is not.
const AT = /^(\d{1,2}:)?\d{1,2}:\d{2}$/;

function normalizeAt(raw: string): string | null {
  const at = raw.trim();
  if (!AT.test(at)) return null;
  const parts = at.split(":");
  if (parts.some((p, i) => i > 0 && Number(p) > 59)) return null;
  return parts.map((p, i) => (i === 0 && parts.length === 2 ? p.padStart(2, "0") : p)).join(":");
}

/// "S1 08:13, s3" -> [{ code: "S1", at: "08:13" }, { code: "S3" }]. What
/// cannot be read is returned by name, so a form can say exactly what is
/// wrong instead of dropping it.
export function parseSourceRefs(raw: string): { refs: SourceRef[]; invalid: string[] } {
  const refs: SourceRef[] = [];
  const invalid: string[] = [];
  for (const part of raw.split(/[,،;\n]+/)) {
    const entry = part.trim();
    if (!entry) continue;
    const m = /^\[?\s*[sS](\d+)\s*(?:[\s@]\s*([\d:]+))?\s*\]?$/.exec(entry);
    if (!m || Number(m[1]) < 1) {
      invalid.push(entry);
      continue;
    }
    const code = sourceCode(Number(m[1]));
    let at: string | undefined;
    if (m[2]) {
      const n = normalizeAt(m[2]);
      if (!n) {
        invalid.push(entry);
        continue;
      }
      at = n;
    }
    if (!refs.some((r) => r.code === code && r.at === at)) refs.push(at ? { code, at } : { code });
  }
  return { refs, invalid };
}

export function formatSourceRef(ref: SourceRef): string {
  return ref.at ? `${ref.code} ${ref.at}` : ref.code;
}

/// Reads a stored `sources` value defensively, like parseFieldStatus.
export function readSourceRefs(value: unknown): SourceRef[] {
  if (!Array.isArray(value)) return [];
  const out: SourceRef[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    if (typeof entry.code !== "string" || !/^S\d+$/.test(entry.code)) continue;
    out.push(typeof entry.at === "string" && entry.at ? { code: entry.code, at: entry.at } : { code: entry.code });
  }
  return out;
}

/// Source codes cited inside free text: "[S1 08:13]", "[S3]", "[S2, S4]".
/// Only bracketed codes count, so "S3 class" in a sentence is left alone.
export function citedCodes(text: string | null | undefined): string[] {
  if (!text) return [];
  const codes = new Set<string>();
  for (const bracket of text.matchAll(/\[([^\]]*)\]/g)) {
    for (const m of bracket[1].matchAll(/\b[sS](\d+)\b/g)) codes.add(sourceCode(Number(m[1])));
  }
  return [...codes];
}

export type RegisterEntry = { code: string; weight: SourceWeightLike };

export type SourceCheck =
  | { ok: true; status: KnowledgeStatusLike; lowered: boolean }
  | { ok: false; error: string };

export const SECONDARY_ONLY_TO_RESOLVE = "אישור מהלקוח או מספק שלו: כל המקורות הם מסמכים של אנקורה.";

/// Rules 1 to 3 for one item. `texts` is the item's free text, checked
/// for cited codes (R17).
export function checkSources(
  status: KnowledgeStatusLike,
  refs: SourceRef[],
  register: RegisterEntry[],
  texts: (string | null | undefined)[] = [],
  /// A person confirmed it on Ankora's documents alone, knowingly
  /// (20.10.2026): not every client puts things in writing. R14 lowers
  /// what arrives that way by itself, not what a person chose to stand
  /// behind.
  confirmedByPerson = false
): SourceCheck {
  const known = new Map(register.map((r) => [r.code, r.weight]));
  const unknown = [...new Set([...refs.map((r) => r.code), ...texts.flatMap(citedCodes)])].filter((c) => !known.has(c));
  if (unknown.length > 0) {
    return { ok: false, error: `${unknown.length === 1 ? "המקור" : "המקורות"} ${unknown.join(", ")} לא ${unknown.length === 1 ? "קיים" : "קיימים"} במרשם של הלקוח.` };
  }
  if (refs.length === 0 && status !== "MISSING" && status !== "SUPERSEDED") {
    return { ok: false, error: 'צריך מקור: מאיפה זה ידוע? אם עוד לא ידוע, סמנו "חסר".' };
  }
  if (!confirmedByPerson && status === "CONFIRMED" && refs.length > 0 && refs.every((r) => known.get(r.code) === "SECONDARY")) {
    return { ok: true, status: "UNCERTAIN", lowered: true };
  }
  return { ok: true, status, lowered: false };
}

/// An Ankora document that writes down what the client said: the summary
/// of an intake meeting, a file Hadas typed while Nadav talked (21.10.2026).
/// It is registered as an Ankora document with the primary weight, so what
/// comes from it is not lowered to "uncertain" by R14.
export const CLIENT_CONVERSATION_LABEL = "סיכום שיחה עם הלקוח";

export function isClientConversation(s: { kind: SourceKindLike; weight: SourceWeightLike }): boolean {
  return s.kind === "ANKORA_DOCUMENT" && s.weight === "PRIMARY";
}

/// An item that is uncertain only because R14 lowered it (every source is
/// an Ankora document) and that cites `code`: what "אושר מול הלקוח" on that
/// source confirms. An item uncertain for any other reason keeps its own
/// "what would close it" and is left alone.
export function uncertainOnlyForAnkora(item: { knowledgeStatus: string; toResolve: string | null; sources: unknown }, code: string): boolean {
  return item.knowledgeStatus === "UNCERTAIN" && item.toResolve === SECONDARY_ONLY_TO_RESOLVE && readSourceRefs(item.sources).some((r) => r.code === code);
}
