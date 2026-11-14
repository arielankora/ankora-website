// The rule list of a proposed extraction guide version, as Claude asks for
// it through propose_extraction_guide_version (14.11.2026). Either the full
// list, or rules added to the version in use at a given place.
//
// Pure, with no imports, so tests/unit/extraction-guide-rules.test.ts holds
// it directly. The rules the domain enforces (not empty, not too long, no
// secret) stay in proposeGuide; this only builds the list.

/// One rule is one line: guideLines() splits the stored body on line
/// breaks, so a rule with a break in it would come back as two.
export function oneLine(rule: string): string {
  return rule.replace(/\s+/g, " ").trim();
}

export type GuideRulesInput = {
  rules?: string[];
  addRules?: string[];
  /// Add after this rule, counted from 1 as the guide shows them; 0 puts
  /// them first. Omitted: at the end.
  afterRule?: number;
};

export type GuideRulesResult = { ok: true; rules: string[] } | { ok: false; message: string };

export function buildGuideRules(current: string[], input: GuideRulesInput): GuideRulesResult {
  const hasFull = input.rules !== undefined;
  const hasAdd = input.addRules !== undefined;
  if (hasFull === hasAdd) {
    return { ok: false, message: "Pass either `rules` (the whole new list) or `addRules` (rules to add to the version in use), not both and not neither. Nothing was proposed." };
  }
  if (hasFull && input.afterRule !== undefined) {
    return { ok: false, message: "`afterRule` goes with `addRules` only. Nothing was proposed." };
  }
  if (hasFull) return { ok: true, rules: input.rules!.map(oneLine).filter(Boolean) };

  const added = input.addRules!.map(oneLine).filter(Boolean);
  if (added.length === 0) return { ok: false, message: "`addRules` has no rule in it. Nothing was proposed." };
  const at = input.afterRule ?? current.length;
  if (!Number.isInteger(at) || at < 0 || at > current.length) {
    return { ok: false, message: `\`afterRule\` must be a rule number from 0 (first) to ${current.length} (the last rule of the version in use). Read get_extraction_brief for the rules in use. Nothing was proposed.` };
  }
  return { ok: true, rules: [...current.slice(0, at), ...added, ...current.slice(at)] };
}

/// Whether two rule lists say the same thing, rule by rule.
export function sameRules(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((r, i) => oneLine(r) === oneLine(b[i]));
}
