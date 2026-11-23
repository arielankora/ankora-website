import { z } from "zod";

// Agents, phase 1 (22.11.2026): the shape of an agent version's blocks,
// parameters and requirements, and the checks a version must pass before a
// manager may approve it. Pure: no database, so the screens, the MCP tools
// and the tests all read the same rules.

/// The kinds of instruction block, in the order Claude reads them.
export const BLOCK_KINDS = ["role", "scope", "steps", "rules", "approvals", "language", "output", "tools", "schedule", "live"] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

/// A parameter key is what appears between the braces: {{חתימה}}.
const KEY = /^[\p{L}\p{N}_]{1,40}$/u;
export const PLACEHOLDER = /\{\{([\p{L}\p{N}_]{1,40})\}\}/gu;

export const blockSchema = z.object({
  key: z.string().regex(KEY),
  kind: z.enum(BLOCK_KINDS),
  title: z.string().trim().min(1).max(120),
  body: z.string().max(20000),
  /// Why the rule exists, for people and for the agent.
  why: z.string().max(2000).nullish(),
  /// Set: a legacy client addition inside an agent version (before
  /// 24.11.2026). Client additions live in AgentClientAddition now.
  clientId: z.string().nullish(),
  /// A guardrail ("never send"): shown apart and flagged when it changes.
  safety: z.boolean().optional(),
  /// The owners allow a client addition to take this block's place for that
  /// client. Never honoured on a safety block.
  overridable: z.boolean().optional(),
  /// In a client addition only: the key of the agent block this one replaces.
  replaces: z.string().regex(KEY).nullish(),
  /// Phase 3: a copy of a library block, kept in step when the library's version is approved.
  sharedKey: z.string().max(60).nullish(),
  sharedVersion: z.number().int().nullish(),
});
export type AgentBlock = z.infer<typeof blockSchema>;

export const PARAM_LEVELS = ["AGENT", "CLIENT", "INSTALLATION"] as const;
/// LIBRARY_BLOCK (23.11.2026): the value is a library block's key, and the
/// compiled text gets that block's approved body in its place. A voice per
/// person: an installation picks ariel-voice or nadav-voice.
/// CONNECTOR and VAULT_REF (23.11.2026): the value only names a connector,
/// or an item in Ankora's vault. A secret's value never reaches the
/// instructions; VAULT_REF compiles to a reference the agent reads itself.
export const PARAM_TYPES = ["TEXT", "LONG_TEXT", "NUMBER", "LIST", "EMAIL", "FILE_LOCATION", "PAGE", "LIBRARY_BLOCK", "CONNECTOR", "VAULT_REF"] as const;
/// Client-level values that come from the client's file instead of being typed twice.
export const CLIENT_FIELDS = ["name", "domains"] as const;

export const paramSchema = z.object({
  key: z.string().regex(KEY),
  label: z.string().trim().min(1).max(80),
  level: z.enum(PARAM_LEVELS),
  type: z.enum(PARAM_TYPES).default("TEXT"),
  required: z.boolean().default(false),
  default: z.string().max(2000).nullish(),
  clientField: z.enum(CLIENT_FIELDS).nullish(),
});
export type AgentParam = z.infer<typeof paramSchema>;

/// A skill the agent needs: its slug, or { slug, minVersion } when an older
/// version of an Ankora skill is not enough (23.11.2026).
export const skillRequirementSchema = z.union([z.string().max(80), z.object({ slug: z.string().trim().min(1).max(80), minVersion: z.number().int().min(1).nullish() })]);
export type SkillRequirement = z.infer<typeof skillRequirementSchema>;

export function skillOf(s: SkillRequirement): { slug: string; minVersion: number | null } {
  return typeof s === "string" ? { slug: s, minVersion: null } : { slug: s.slug, minVersion: s.minVersion ?? null };
}

/// "gmail-labels@3" in the requirements form, and back.
export function skillText(s: SkillRequirement): string {
  const { slug, minVersion } = skillOf(s);
  return minVersion ? `${slug}@${minVersion}` : slug;
}
export function parseSkillText(text: string): SkillRequirement {
  const m = /^(.+?)@(\d+)$/.exec(text.trim());
  return m ? { slug: m[1].trim(), minVersion: Number(m[2]) } : text.trim();
}

export const requirementsSchema = z.object({
  connectors: z.array(z.string().max(80)).max(30).default([]),
  skills: z.array(skillRequirementSchema).max(30).default([]),
  repos: z.array(z.string().max(120)).max(10).default([]),
  localMcp: z.array(z.string().max(80)).max(10).default([]),
  externalRunners: z.array(z.string().max(200)).max(10).default([]),
  model: z.string().max(80).nullish(),
  notes: z.string().max(2000).nullish(),
});
export type AgentRequirements = z.infer<typeof requirementsSchema>;

/// A text file attached to a version (23.11.2026): a script, a template or a
/// reference the instructions point to by path. Binary files do not belong
/// here; a path names where it sits for the agent ("scripts/build.py").
const FILE_PATH = /^(?!\/)(?!.*\.\.)[\p{L}\p{N}_.\- ]+(\/[\p{L}\p{N}_.\- ]+)*$/u;
export const fileSchema = z.object({
  path: z.string().trim().min(1).max(200).regex(FILE_PATH),
  content: z.string().max(200_000),
});
export type AgentFile = z.infer<typeof fileSchema>;

/// 30 parameters (23.11.2026, was 20): the outbound campaigns carry a sender,
/// accounts, a dozen state files and their quotas as numbers, and the larger
/// ones (DeepSignals, Grantor) passed 20 once the quotas became parameters.
export const LIMITS = { blocks: 30, params: 30, compiledChars: 40000, files: 30, filesChars: 1_000_000 } as const;

export function parseBlocks(raw: unknown): AgentBlock[] {
  const r = z.array(blockSchema).safeParse(raw);
  return r.success ? r.data : [];
}
export function parseParams(raw: unknown): AgentParam[] {
  const r = z.array(paramSchema).safeParse(raw);
  return r.success ? r.data : [];
}
export function parseFiles(raw: unknown): AgentFile[] {
  const r = z.array(fileSchema).safeParse(raw ?? []);
  return r.success ? r.data : [];
}
export function parseRequirements(raw: unknown): AgentRequirements {
  const r = requirementsSchema.safeParse(raw ?? {});
  return r.success ? r.data : requirementsSchema.parse({});
}

export function placeholdersIn(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((m) => m[1]);
}

const DASHES = /[\u2013\u2014]/;

export type VersionProblem = { code: string; text: string };

/// What stops a version from being sent for approval. Everything the
/// version-screen checks list shows comes from here.
export function versionProblems(input: { blocks: AgentBlock[]; params: AgentParam[]; files?: AgentFile[]; changeNote?: string | null; clientIds?: Set<string>; actionLevel?: "READ" | "DRAFT" | "SEND" }): VersionProblem[] {
  const out: VersionProblem[] = [];
  const { blocks, params } = input;
  // "סוכן ששולח חייב להגדיר מכסה" (23.11.2026): checked on new approvals only.
  if (input.actionLevel === "SEND" && !params.some((p) => p.type === "NUMBER")) out.push({ code: "sendNeedsQuota", text: "סוכן ששולח בשם אדם חייב מכסה: צריך פרמטר מסוג מספר (למשל כמה הודעות ביום) ולכתוב בהוראות איך הוא נאכף." });
  const files = input.files ?? [];
  if (files.length > LIMITS.files) out.push({ code: "tooManyFiles", text: `יותר מ-${LIMITS.files} קבצים מצורפים.` });
  if (files.reduce((n, f) => n + f.content.length, 0) > LIMITS.filesChars) out.push({ code: "filesTooLarge", text: "הקבצים המצורפים גדולים מדי יחד." });
  if (new Set(files.map((f) => f.path)).size !== files.length) out.push({ code: "duplicateFile", text: "שני קבצים באותו נתיב." });
  if (blocks.length === 0) out.push({ code: "noBlocks", text: "אין בסוכן אף קטע הוראות." });
  if (blocks.length > LIMITS.blocks) out.push({ code: "tooManyBlocks", text: `יותר מ-${LIMITS.blocks} קטעים.` });
  if (params.length > LIMITS.params) out.push({ code: "tooManyParams", text: `יותר מ-${LIMITS.params} פרמטרים.` });
  const keys = new Set<string>();
  for (const b of blocks) {
    if (keys.has(b.key)) out.push({ code: "duplicateBlock", text: `שני קטעים באותו מפתח: ${b.key}.` });
    keys.add(b.key);
    if (b.clientId && input.clientIds && !input.clientIds.has(b.clientId)) out.push({ code: "unknownClient", text: `התוספת "${b.title}" מפנה ללקוח שלא קיים.` });
  }
  const paramKeys = new Set(params.map((p) => p.key));
  if (paramKeys.size !== params.length) out.push({ code: "duplicateParam", text: "שני פרמטרים באותו שם." });
  for (const p of params) {
    if (p.clientField && p.level !== "CLIENT") out.push({ code: "clientFieldLevel", text: `"${p.label}" נלקח מתיק הלקוח, ולכן הוא פרמטר ברמת לקוח.` });
  }
  const missing = new Set<string>();
  for (const b of blocks) for (const k of placeholdersIn(b.body)) if (!paramKeys.has(k)) missing.add(k);
  for (const k of missing) out.push({ code: "undefinedParam", text: `{{${k}}} מופיע בהוראות ולא מוגדר כפרמטר.` });
  const texts = [...blocks.flatMap((b) => [b.title, b.body, b.why ?? ""]), ...params.flatMap((p) => [p.label, p.default ?? ""]), input.changeNote ?? ""];
  if (texts.some((t) => DASHES.test(t))) out.push({ code: "dash", text: "יש בטקסט מקף ארוך או בינוני." });
  return out;
}

/// Whether a client addition may take the place of this agent block.
export function canReplace(block: AgentBlock | undefined): boolean {
  return !!block && !block.clientId && !!block.overridable && !block.safety;
}

/// What stops a client addition from being sent for approval. `agentBlocks`
/// are the blocks of the agent's version in use, the ones it may replace.
export function additionProblems(input: { blocks: AgentBlock[]; agentBlocks: AgentBlock[]; params: AgentParam[]; changeNote?: string | null }): VersionProblem[] {
  const out: VersionProblem[] = [];
  const { blocks } = input;
  if (blocks.length > LIMITS.blocks) out.push({ code: "tooManyBlocks", text: `יותר מ-${LIMITS.blocks} קטעים.` });
  const keys = new Set<string>();
  const replaced = new Set<string>();
  const agent = new Map(input.agentBlocks.filter((b) => !b.clientId).map((b) => [b.key, b]));
  for (const b of blocks) {
    if (keys.has(b.key)) out.push({ code: "duplicateBlock", text: `שני קטעים באותו מפתח: ${b.key}.` });
    keys.add(b.key);
    if (!b.replaces) continue;
    const target = agent.get(b.replaces);
    if (!target) out.push({ code: "replaceMissing", text: `"${b.title}" מחליף קטע שאין בסוכן (${b.replaces}).` });
    else if (target.safety) out.push({ code: "replaceSafety", text: `"${target.title}" הוא גבול בטיחות, ולא ניתן להחליף אותו ללקוח.` });
    else if (!target.overridable) out.push({ code: "replaceNotAllowed", text: `"${target.title}" לא מסומן "ניתן להחלפה ללקוח". בלי הסימון התוספת תתווסף לצידו.` });
    if (replaced.has(b.replaces)) out.push({ code: "replaceTwice", text: `שני קטעים מחליפים את אותו קטע (${b.replaces}).` });
    replaced.add(b.replaces);
  }
  const paramKeys = new Set(input.params.map((p) => p.key));
  const missing = new Set<string>();
  for (const b of blocks) for (const k of placeholdersIn(b.body)) if (!paramKeys.has(k)) missing.add(k);
  for (const k of missing) out.push({ code: "undefinedParam", text: `{{${k}}} מופיע בתוספת ולא מוגדר כפרמטר בסוכן.` });
  const texts = [...blocks.flatMap((b) => [b.title, b.body, b.why ?? ""]), input.changeNote ?? ""];
  if (texts.some((t) => DASHES.test(t))) out.push({ code: "dash", text: "יש בטקסט מקף ארוך או בינוני." });
  return out;
}
