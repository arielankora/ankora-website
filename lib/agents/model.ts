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
  /// Set: a client addition, reaching only this client.
  clientId: z.string().nullish(),
  /// A guardrail ("never send"): shown apart and flagged when it changes.
  safety: z.boolean().optional(),
  /// Phase 3: a copy of a library block, kept in step when the library's version is approved.
  sharedKey: z.string().max(60).nullish(),
  sharedVersion: z.number().int().nullish(),
});
export type AgentBlock = z.infer<typeof blockSchema>;

export const PARAM_LEVELS = ["AGENT", "CLIENT", "INSTALLATION"] as const;
export const PARAM_TYPES = ["TEXT", "LONG_TEXT", "NUMBER", "LIST", "EMAIL", "FILE_LOCATION", "PAGE"] as const;
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

export const requirementsSchema = z.object({
  connectors: z.array(z.string().max(80)).max(30).default([]),
  skills: z.array(z.string().max(80)).max(30).default([]),
  repos: z.array(z.string().max(120)).max(10).default([]),
  localMcp: z.array(z.string().max(80)).max(10).default([]),
  externalRunners: z.array(z.string().max(200)).max(10).default([]),
  model: z.string().max(80).nullish(),
  notes: z.string().max(2000).nullish(),
});
export type AgentRequirements = z.infer<typeof requirementsSchema>;

export const LIMITS = { blocks: 30, params: 20, compiledChars: 40000 } as const;

export function parseBlocks(raw: unknown): AgentBlock[] {
  const r = z.array(blockSchema).safeParse(raw);
  return r.success ? r.data : [];
}
export function parseParams(raw: unknown): AgentParam[] {
  const r = z.array(paramSchema).safeParse(raw);
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
export function versionProblems(input: { blocks: AgentBlock[]; params: AgentParam[]; changeNote?: string | null; clientIds?: Set<string> }): VersionProblem[] {
  const out: VersionProblem[] = [];
  const { blocks, params } = input;
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
