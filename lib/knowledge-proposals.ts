// Proposals to the client file: their shape, their words, and the checks
// that need no database (claude/org-brain-spec-2026-10-12.md, 5.1, 5.2).
// Pure, so the MCP tool, the domain and the review screen share one
// definition of what a proposal may say.

import { z } from "zod";
import { citedCodes } from "@/lib/knowledge-sources";
import { factShapeError } from "@/lib/client-facts";
import { NEEDS_INTERIM, type PolicyKindLike } from "@/lib/client-policies";
import { blockingChecks, readSteps } from "@/lib/process-rules";
import { clientVisibleBlocker } from "@/lib/knowledge";

const knowledge = {
  knowledgeStatus: z.enum(["CONFIRMED", "UNCERTAIN", "MISSING"]).optional(),
  toResolve: z.string().max(500).nullish(),
  importance: z.enum(["NORMAL", "LOW"]).optional(),
  sensitivity: z.enum(["NORMAL", "SENSITIVE"]).optional(),
  doNotDisclose: z.string().max(500).nullish(),
  /// Spec 3.1: shown to the client in the portal, only when the client said
  /// it may be (it is theirs, or it was agreed with them).
  clientVisible: z.boolean().optional(),
  /// Spec 3.1: who at Ankora keeps the item right, by name.
  ownerName: z.string().max(200).nullish(),
};

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD")
  .nullish();

export const FactPayload = z.object({
  kind: z.enum(["SCOPE_IN", "SCOPE_OUT", "PREFERENCE", "REQUIREMENT", "LOCATION", "FINANCE", "TEMPORARY", "ONE_OFF_DECISION", "QUESTION", "NOTE"]),
  body: z.string().min(1).max(2000),
  topic: z.enum(["COMMUNICATION", "REPORTING", "DOCUMENTS", "AUTOMATION", "ADMINS", "PAYMENTS", "SUPPLIERS", "OTHER"]).nullish(),
  referTo: z.string().max(300).nullish(),
  validUntil: day,
  validUntilEvent: z.string().max(300).nullish(),
  decidedAt: day,
  decidedBy: z.string().max(200).nullish(),
  ...knowledge,
});

export const ContactPayload = z.object({
  name: z.string().max(200).nullish(),
  role: z.string().max(200).nullish(),
  relationship: z.enum(["CLIENT_STAFF", "PROVIDER", "ADVISOR", "INVESTOR", "SUPPLIER", "ANKORA"]).optional(),
  emails: z.array(z.string().max(200)).max(10).optional(),
  phones: z.array(z.string().max(50)).max(10).optional(),
  organizationName: z.string().max(200).nullish(),
  context: z.string().max(2000).nullish(),
  channelOrder: z.array(z.string().max(50)).max(10).optional(),
  isPrimary: z.boolean().optional(),
  isDecisionMaker: z.boolean().optional(),
  ...knowledge,
});

export const OrganizationPayload = z.object({
  name: z.string().min(1).max(200),
  domains: z.array(z.string().max(200)).max(10).optional(),
  role: z.string().max(300).nullish(),
  relationship: z.enum(["PROVIDER", "ADVISOR", "SUPPLIER", "INVESTOR"]).optional(),
  monthlyCostMinor: z.number().int().nonnegative().nullish(),
  currency: z.enum(["ILS", "USD"]).nullish(),
  notes: z.string().max(2000).nullish(),
  ...knowledge,
});

export const SystemPayload = z.object({
  systemName: z.string().min(1).max(200),
  purpose: z.string().max(300).nullish(),
  url: z.string().max(500).nullish(),
  accountUsed: z.string().max(200).nullish(),
  ourPermission: z.enum(["NONE", "VIEWER", "USER", "BILLING", "ADMIN", "OWNER"]).optional(),
  accessStatus: z.enum(["HAS_ACCESS", "PENDING", "NO_ACCESS", "NOT_NEEDED"]).optional(),
  blocker: z.string().max(500).nullish(),
  clientAdmin: z.string().max(300).nullish(),
  notes: z.string().max(2000).nullish(),
  ...knowledge,
});

export const RequestTypePayload = z.object({
  title: z.string().min(1).max(200),
  fromWho: z.string().max(200).nullish(),
  arrivesVia: z.string().max(200).nullish(),
  handling: z.string().min(1).max(2000),
  ...knowledge,
});

export const PolicyPayload = z.object({
  kind: z.enum(["DATA_HANDLING", "DISCLOSURE", "COMMUNICATION", "SEPARATION", "APPROVAL_REQUIRED", "THRESHOLD", "REQUIRED_STEP", "TIMING", "FORBIDDEN", "INFO"]),
  title: z.string().min(1).max(200),
  statement: z.string().min(1).max(2000),
  rationale: z.string().max(1000).nullish(),
  interimStatement: z.string().max(1000).nullish(),
  ...knowledge,
});

/// A legal entity of the client (spec 3.3). The parent is named, and
/// found among the client's entities when the proposal is approved.
export const EntityPayload = z.object({
  name: z.string().min(1).max(200),
  legalName: z.string().max(300).nullish(),
  registrationNumber: z.string().max(100).nullish(),
  country: z.string().max(100).nullish(),
  currency: z.string().max(10).nullish(),
  billingAddress: z.string().max(500).nullish(),
  parentName: z.string().max(200).nullish(),
  ...knowledge,
});

export const NARRATIVE_KIND_LABELS = { OVERVIEW: "סקירה", BACKGROUND: "רקע", OUR_ROLE: "התפקיד שלנו" } as const;

/// A new version of one of the file's free texts (spec 3.3). It replaces
/// the whole text, so it is written against the version that was current
/// when it was proposed: a text someone changed since is not overwritten.
/// The server records that version; Claude does not send it.
export const NarrativePayload = z.object({
  kind: z.enum(["OVERVIEW", "BACKGROUND", "OUR_ROLE"]),
  body: z.string().min(1).max(20000),
  baseVersion: z.number().int().nonnegative().optional(),
});

const ProposedStep = z.object({
  title: z.string().min(1).max(300),
  mode: z.enum(["MANUAL", "ASSISTED", "AUTOMATED"]).optional(),
  offsetBusinessDays: z.number().int().min(-60).max(60).nullish(),
  actionTags: z.array(z.string().max(40)).max(13).optional(),
  output: z.string().max(500).nullish(),
  verification: z.string().max(500).nullish(),
  requiresApproval: z.boolean().optional(),
});

/// A process (spec 3.8), with its procedure when it was described. It
/// enters the file as a draft: the procedure runs only once a manager
/// approves it, on the processes screen.
export const ProcessPayload = z.object({
  title: z.string().min(1).max(200),
  purpose: z.string().max(500).nullish(),
  triggerKinds: z.array(z.enum(["SCHEDULED", "EVENT", "ON_DEMAND", "CONTINUOUS"])).max(4).optional(),
  triggerText: z.string().max(500).nullish(),
  slaText: z.string().max(500).nullish(),
  externalPartyText: z.string().max(500).nullish(),
  approverText: z.string().max(300).nullish(),
  approvalText: z.string().max(500).nullish(),
  exceptionPlaybook: z.string().max(4000).nullish(),
  executorText: z.string().max(300).nullish(),
  transitionStatus: z.enum(["WITH_CLIENT", "IN_HANDOVER", "WITH_ANKORA", "NOT_PLANNED"]).optional(),
  steps: z.array(ProposedStep).max(15).optional(),
  highlights: z.string().max(4000).nullish(),
  outputs: z.string().max(2000).nullish(),
  ...knowledge,
});

/// An email domain that identifies the client's meetings (spec 3.5).
export const DomainPayload = z.object({
  domain: z.string().min(3).max(200),
  kind: z.enum(["CLIENT", "PARTNER"]),
  organizationName: z.string().max(200).nullish(),
});

export const PAYLOADS = {
  FACT: FactPayload,
  CONTACT: ContactPayload,
  ORGANIZATION: OrganizationPayload,
  SYSTEM: SystemPayload,
  REQUEST_TYPE: RequestTypePayload,
  POLICY: PolicyPayload,
  ENTITY: EntityPayload,
  NARRATIVE: NarrativePayload,
  PROCESS: ProcessPayload,
  DOMAIN: DomainPayload,
} as const;
export type ProposalTargetLike = keyof typeof PAYLOADS;
export type ProposalActionLike = "CREATE" | "SUPERSEDE" | "CONTRADICT";

export const TARGET_LABELS: Record<ProposalTargetLike, string> = {
  FACT: "עובדה",
  CONTACT: "איש קשר",
  ORGANIZATION: "ספק או נותן שירות",
  SYSTEM: "מערכת",
  REQUEST_TYPE: "סוג פנייה",
  POLICY: "כלל של הלקוח",
  ENTITY: "ישות משפטית",
  NARRATIVE: "סקירה, רקע או תפקידנו",
  PROCESS: "תהליך",
  DOMAIN: "דומיין",
};

export const ACTION_LABELS: Record<ProposalActionLike, string> = {
  CREATE: "חדש",
  SUPERSEDE: "גרסה חדשה לפריט קיים",
  CONTRADICT: "סותר פריט קיים",
};

/// `block`: approving it as it stands would break a rule that is not
/// waived (spec 5.2: "הפרה של כלל חובה: האישור חסום"). It can be edited
/// and approved, or rejected. Everything else is advice for the reviewer.
export type ProposalFlag = { code: string; message: string; block?: boolean };

/// What stops a proposal from entering the file as it stands, found
/// without asking anybody (spec 5.2, 7.2). The same checks the file's own
/// functions make when it is written, said on the card before anyone
/// presses approve, and made again on the approved text after any edit:
/// - R17: a source code cited in the text that is not in the register.
/// - The item's own shape: temporary information without an end, a
///   one-off decision without a date, a proposed approval rule without
///   the interim rule that applies until it is approved.
/// A process enters as a draft, so what its procedure fails (R1, R3, R4)
/// is said here but does not block the proposal: it blocks the procedure's
/// approval, on the processes screen.
export function proposalProblems(target: ProposalTargetLike, payload: Record<string, unknown>, registerCodes: string[]): ProposalFlag[] {
  const out: ProposalFlag[] = [];
  const known = new Set(registerCodes);
  const unknown = [...new Set(Object.values(payload).flatMap((v) => (typeof v === "string" ? citedCodes(v) : [])))].filter((c) => !known.has(c));
  if (unknown.length) out.push({ code: "R17", block: true, message: `הטקסט מצטט ${unknown.join(", ")}, ${unknown.length === 1 ? "שלא קיים" : "שלא קיימים"} במרשם המקורות של הלקוח. מתקנים את הקוד בעריכה, או דוחים.` });
  const s = (k: string) => (typeof payload[k] === "string" ? (payload[k] as string) : null);
  if (target === "FACT") {
    const shape = factShapeError({ kind: payload.kind as never, body: s("body") ?? "", validUntil: s("validUntil") ? new Date(s("validUntil")!) : null, validUntilEvent: s("validUntilEvent"), decidedAt: s("decidedAt") ? new Date(s("decidedAt")!) : null });
    if (shape) out.push({ code: "SHAPE", block: true, message: `${shape} משלימים בעריכה, או דוחים.` });
  }
  if (target === "POLICY" && NEEDS_INTERIM.includes(payload.kind as PolicyKindLike) && !s("interimStatement")?.trim()) {
    out.push({ code: "SHAPE", block: true, message: 'חסר כלל ביניים: מה עושים עד שהכלל מאושר. משלימים "עד שיאושר" בעריכה, או דוחים.' });
  }
  // Spec 3.1: shown to the client only when nothing forbids it.
  if (payload.clientVisible === true) {
    const why = clientVisibleBlocker({ sensitivity: s("sensitivity"), doNotDisclose: s("doNotDisclose") });
    if (why) out.push({ code: "VISIBLE", block: true, message: `${why} מורידים את "גלוי ללקוח" בעריכה, או דוחים.` });
  }
  if (target === "PROCESS" && Array.isArray(payload.steps) && payload.steps.length) {
    for (const c of blockingChecks({ steps: readSteps(payload.steps) }, [])) out.push({ code: c.code, message: `${c.message} (התהליך ייכנס כטיוטה, והנוהל לא יאושר עד שזה יתוקן.)` });
  }
  return out;
}

/// The most proposals decided in one action.
export const MAX_BULK = 60;

/// Why a proposal is decided on its own and not approved with others, or
/// null when it may be. Approving together is still a person approving on
/// the screen (decision 1); what stays one at a time is what changes an
/// item already in the file, what may already be there, and what is
/// sensitive. Rejecting together is always allowed: nothing enters the
/// file.
export function bulkApproveBlocker(p: { action: ProposalActionLike; flags: ProposalFlag[]; payload: Record<string, unknown> }): string | null {
  if (p.flags.some((f) => f.block)) return "יש בה משהו שחוסם אישור";
  if (p.action !== "CREATE") return "משנה פריט שכבר בתיק";
  if (p.flags.some((f) => f.code === "DUPLICATE")) return "ייתכן שכבר בתיק";
  if (p.flags.some((f) => f.code === "R6") || p.payload.sensitivity === "SENSITIVE") return "מידע רגיש";
  return null;
}

/// The line a proposal is known by, on its card and in a list.
export function proposalHeadline(target: ProposalTargetLike, payload: Record<string, unknown>): string {
  const s = (k: string) => (typeof payload[k] === "string" ? (payload[k] as string) : "");
  switch (target) {
    case "FACT":
      return s("body");
    case "CONTACT":
      return [s("name"), s("role")].filter(Boolean).join(", ");
    case "ORGANIZATION":
      return [s("name"), s("role")].filter(Boolean).join(", ");
    case "REQUEST_TYPE":
      return [s("title"), s("handling")].filter(Boolean).join(": ");
    case "POLICY":
      return [s("title"), s("statement")].filter(Boolean).join(": ");
    case "SYSTEM":
      return [s("systemName"), s("purpose")].filter(Boolean).join(", ");
    case "ENTITY":
      return [s("name"), s("legalName")].filter(Boolean).join(", ");
    case "NARRATIVE":
      return s("body").length > 160 ? `${s("body").slice(0, 157)}...` : s("body");
    case "PROCESS":
      return [s("title"), s("purpose")].filter(Boolean).join(": ");
    case "DOMAIN":
      return [s("domain"), s("organizationName")].filter(Boolean).join(", ");
  }
}

/// What a reviewer needs beyond the headline to decide: a process's steps,
/// an entity's identifiers, the whole of a long text. Empty for the rest.
export function proposalDetails(target: ProposalTargetLike, payload: Record<string, unknown>): string[] {
  // Spec 3.1, on every kind of item.
  const common = [payload.clientVisible === true ? "גלוי ללקוח" : "", typeof payload.ownerName === "string" && payload.ownerName.trim() ? `בעלים: ${payload.ownerName.trim()}` : ""].filter(Boolean);
  return [...itemDetails(target, payload), ...common];
}

function itemDetails(target: ProposalTargetLike, payload: Record<string, unknown>): string[] {
  const s = (k: string) => (typeof payload[k] === "string" ? (payload[k] as string) : "");
  if (target === "PROCESS") {
    const steps = Array.isArray(payload.steps) ? (payload.steps as { title?: unknown; requiresApproval?: unknown }[]) : [];
    return [
      s("triggerText") && `מה מפעיל: ${s("triggerText")}`,
      s("slaText") && `SLA: ${s("slaText")}`,
      ...steps.map((st, i) => `${i + 1}. ${typeof st.title === "string" ? st.title : ""}${st.requiresApproval ? " (דורש אישור)" : ""}`),
    ].filter((x): x is string => !!x);
  }
  if (target === "ENTITY") {
    return [s("registrationNumber"), s("country"), s("currency"), s("parentName") && `בת של ${s("parentName")}`].filter((x): x is string => !!x);
  }
  if (target === "NARRATIVE") return s("body").length > 160 ? [s("body")] : [];
  if (target === "DOMAIN") return [payload.kind === "PARTNER" ? "דומיין של שותף" : "דומיין של הלקוח"];
  return [];
}

/// Decision 1: after the first month, if fewer than 10% of approved
/// proposals were edited first, light items may be approved in
/// conversation too. The line a manager reads on the review screen.
export const DECISION_1_LIMIT = 0.1;
export const DECISION_1_DAYS = 30;

export function qualityLine(
  q: { approved: number; editedBeforeApproval: number; rejected: number; firstDecidedAt: Date | null },
  now: Date
): { text: string; tone: "neutral" | "good" | "warn" } {
  if (q.approved === 0 && q.rejected === 0) return { text: `עוד לא הוחלט על הצעות ב-${DECISION_1_DAYS} הימים האחרונים.`, tone: "neutral" };
  const share = q.approved ? q.editedBeforeApproval / q.approved : 0;
  const pct = Math.round(share * 1000) / 10;
  const head = `ב-${DECISION_1_DAYS} הימים האחרונים: ${q.approved} אושרו, ${q.editedBeforeApproval} מהן אחרי עריכה (${pct}%), ${q.rejected} נדחו.`;
  const monthEnds = q.firstDecidedAt ? new Date(q.firstDecidedAt.getTime() + DECISION_1_DAYS * 86_400_000) : null;
  if (monthEnds && monthEnds.getTime() > now.getTime()) {
    const d = new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric", year: "numeric", timeZone: "Asia/Jerusalem" }).format(monthEnds);
    return { text: `${head} החודש הראשון נגמר ב-${d}. אז מחליטים אם אפשר לאשר פריטים קלים גם בשיחה (היעד: פחות מ-10% עם עריכה).`, tone: "neutral" };
  }
  return share < DECISION_1_LIMIT
    ? { text: `${head} פחות מ-10% תוקנו: לפי החלטה 1 אפשר לשקול לאשר פריטים קלים גם בשיחה.`, tone: "good" }
    : { text: `${head} יותר מ-10% תוקנו: ממשיכים לאשר רק כאן.`, tone: "warn" };
}

/// Every string a proposal carries, for the secret scan: a secret in a
/// context field leaks as surely as one in the body.
export function payloadText(payload: unknown): string {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(payload);
  return out.join("\n");
}

/// Fireflies opens a recording at a second: "08:13" -> 493.
export function secondsOf(at: string | null | undefined): number | null {
  if (!at || !/^(\d{1,2}:)?\d{1,2}:\d{2}$/.test(at)) return null;
  return at.split(":").reduce((acc, p) => acc * 60 + Number(p), 0);
}

export function firefliesLink(id: string, at?: string | null): string {
  const t = secondsOf(at);
  return `https://app.fireflies.ai/view/${encodeURIComponent(id)}${t !== null ? `?t=${t}` : ""}`;
}

/// For "already in the file": the same words, ignoring case, spacing and
/// punctuation, are the same fact.
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
