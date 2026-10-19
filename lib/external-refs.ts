// Spec 3.1: where else an item lives, as the team knows it: RAID-002,
// HND-014, a ClickUp record. Typed as text ("RAID-002, ClickUp:86c1x"),
// kept as { system, id }. Pure.
//
// The product writes refs of its own too (a question opened for a date
// carries { system: "ImportantDate" }). Those are not the team's to edit:
// a form never shows them and never drops them.

export type ExternalRef = { system: string; id: string; occurrence?: string };

/// Refs the product writes for itself.
export const INTERNAL_REF_SYSTEMS = ["ImportantDate"];

const isInternal = (r: ExternalRef) => INTERNAL_REF_SYSTEMS.includes(r.system);

export function readExternalRefs(value: unknown): ExternalRef[] {
  if (!Array.isArray(value)) return [];
  return value.filter((r): r is ExternalRef => !!r && typeof r === "object" && typeof (r as ExternalRef).system === "string" && typeof (r as ExternalRef).id === "string");
}

/// "RAID-002" is RAID's 002; "ClickUp:86c1x" names its system; a bare word
/// is its own system.
export function parseExternalRefs(text: string): ExternalRef[] {
  const out: ExternalRef[] = [];
  for (const raw of text.split(/[,\n،]+/)) {
    const t = raw.trim().slice(0, 120);
    if (!t) continue;
    const colon = t.indexOf(":");
    const ref =
      colon > 0
        ? { system: t.slice(0, colon).trim(), id: t.slice(colon + 1).trim() }
        : { system: (t.match(/^([A-Za-z֐-׿]+)[-\s]/)?.[1] ?? t).trim(), id: t };
    if (!ref.system || !ref.id || INTERNAL_REF_SYSTEMS.includes(ref.system)) continue;
    if (!out.some((o) => o.system === ref.system && o.id === ref.id)) out.push(ref);
  }
  return out.slice(0, 20);
}

/// How a ref reads: "RAID-002", "ClickUp 86c1x".
export function refLabel(r: ExternalRef): string {
  return r.id.toLowerCase().startsWith(r.system.toLowerCase()) ? r.id : `${r.system} ${r.id}`;
}

/// The team's refs, as text for the form.
export function refsText(value: unknown): string {
  return readExternalRefs(value).filter((r) => !isInternal(r)).map((r) => (r.id.toLowerCase().startsWith(r.system.toLowerCase()) ? r.id : `${r.system}:${r.id}`)).join(", ");
}

/// The team's refs only, for display.
export function teamRefs(value: unknown): ExternalRef[] {
  return readExternalRefs(value).filter((r) => !isInternal(r));
}

/// What an item ends with when the team edits its refs: theirs, and the
/// product's own kept as they were.
export function withInternalRefs(before: unknown, team: ExternalRef[]): ExternalRef[] {
  return [...readExternalRefs(before).filter(isInternal), ...team.filter((r) => !isInternal(r))];
}
