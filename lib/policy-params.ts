// What a client's rule says in a form the server can check
// (claude/org-brain-spec-2026-10-12.md, 3.11, 7.2: R2, R7 to R10, R15,
// R16). Pure: no Prisma, so the screen, the server and the tests share one
// reading of a rule.
//
// The words of a rule stay the rule. Parameters are optional: a rule
// without them is read by people and by Claude, and the server says so
// rather than pretending to check it. A rule with them is checked against
// every procedure of the client, and the check names the rule.

import { ACTION_TAGS, ACTION_TAG_LABELS, CHANNELS, CHANNEL_LABELS, MONEY_TAGS, type ActionTag, type Channel, type ProcessStep } from "@/lib/process-rules";

export { CHANNELS, CHANNEL_LABELS, type Channel };
import type { PolicyKindLike, PolicyStatusLike } from "@/lib/client-policies";

export type PolicyParams = {
  /// The step tags the rule is about. Each kind reads it its own way.
  appliesToTags?: ActionTag[];
  /// Only procedures of this legal entity (an Inc rule does not bind Ltd).
  entityId?: string;
  /// THRESHOLD: above this, a person approves. Minor units, as all money.
  amountMinor?: number;
  currency?: string;
  /// TIMING: how many business days before the date the step happens.
  leadBusinessDays?: number;
  /// COMMUNICATION: the channels a client message may go through.
  channels?: Channel[];
  /// COMMUNICATION: where invoices of the client's systems must arrive
  /// (an address, or a domain such as nux.ai). R16.
  invoiceTo?: string[];
  /// REQUIRED_STEP: words a step of the procedure must contain.
  mustInclude?: string;
  /// SEPARATION: the entities kept apart, two or more.
  entityIds?: string[];
};

/// Which parameters each kind takes. A kind not listed takes none.
const KIND_KEYS: Partial<Record<PolicyKindLike, (keyof PolicyParams)[]>> = {
  THRESHOLD: ["amountMinor", "currency", "appliesToTags", "entityId"],
  APPROVAL_REQUIRED: ["appliesToTags", "entityId"],
  REQUIRED_STEP: ["mustInclude", "appliesToTags", "entityId"],
  SEPARATION: ["entityIds"],
  TIMING: ["leadBusinessDays", "appliesToTags", "entityId"],
  COMMUNICATION: ["channels", "invoiceTo", "appliesToTags", "entityId"],
  FORBIDDEN: ["appliesToTags", "entityId"],
};

export function kindTakesParams(kind: PolicyKindLike): boolean {
  return !!KIND_KEYS[kind];
}

const tags = (v: unknown): ActionTag[] =>
  Array.isArray(v) ? [...new Set(v.filter((t): t is ActionTag => ACTION_TAGS.includes(t as ActionTag)))] : [];
const strings = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string").map((x) => x.trim().toLowerCase().slice(0, max)).filter(Boolean))] : [];

/// Whatever was stored or sent, as the parameters this kind takes. An
/// empty object means "not checked by code".
export function readParams(kind: PolicyKindLike, value: unknown): PolicyParams {
  const keys = KIND_KEYS[kind];
  if (!keys || !value || typeof value !== "object") return {};
  const v = value as Record<string, unknown>;
  const out: PolicyParams = {};
  if (keys.includes("appliesToTags")) {
    const t = tags(v.appliesToTags);
    if (t.length) out.appliesToTags = t;
  }
  if (keys.includes("entityId") && typeof v.entityId === "string" && v.entityId) out.entityId = v.entityId;
  if (keys.includes("amountMinor") && typeof v.amountMinor === "number" && Number.isInteger(v.amountMinor) && v.amountMinor >= 0) out.amountMinor = v.amountMinor;
  if (keys.includes("currency") && typeof v.currency === "string" && /^[A-Za-z]{3}$/.test(v.currency.trim())) out.currency = v.currency.trim().toUpperCase();
  if (keys.includes("leadBusinessDays") && typeof v.leadBusinessDays === "number" && Number.isInteger(v.leadBusinessDays) && v.leadBusinessDays >= 1 && v.leadBusinessDays <= 60) {
    out.leadBusinessDays = v.leadBusinessDays;
  }
  if (keys.includes("channels") && Array.isArray(v.channels)) {
    const c = [...new Set(v.channels.filter((x): x is Channel => CHANNELS.includes(x as Channel)))];
    if (c.length) out.channels = c;
  }
  if (keys.includes("invoiceTo")) {
    const a = strings(v.invoiceTo, 200).map((x) => x.replace(/^@/, ""));
    if (a.length) out.invoiceTo = a;
  }
  if (keys.includes("mustInclude") && typeof v.mustInclude === "string" && v.mustInclude.trim()) out.mustInclude = v.mustInclude.trim().slice(0, 200);
  if (keys.includes("entityIds") && Array.isArray(v.entityIds)) {
    const e = [...new Set(v.entityIds.filter((x): x is string => typeof x === "string" && !!x))];
    if (e.length) out.entityIds = e;
  }
  return out;
}

export function hasParams(p: PolicyParams): boolean {
  return Object.keys(p).length > 0;
}

/// What is missing for the parameters to mean anything. Null when they are
/// complete, or when there are none (a rule may be text only).
export function paramsError(kind: PolicyKindLike, p: PolicyParams): string | null {
  if (!hasParams(p)) return null;
  switch (kind) {
    case "THRESHOLD":
      if (p.amountMinor === undefined || !p.currency) return "סף צריך סכום ומטבע.";
      return null;
    case "APPROVAL_REQUIRED":
    case "FORBIDDEN":
      if (!p.appliesToTags?.length) return "צריך לבחור על אילו פעולות הכלל חל.";
      return null;
    case "REQUIRED_STEP":
      if (!p.mustInclude) return "צריך לכתוב מה חייב להופיע בשלבים.";
      return null;
    case "TIMING":
      if (!p.leadBusinessDays || !p.appliesToTags?.length) return "תזמון צריך מספר ימי עסקים, ועל אילו פעולות הוא חל.";
      return null;
    case "COMMUNICATION":
      if (!p.channels?.length && !p.invoiceTo?.length) return "צריך ערוצים מותרים, או לאן חשבוניות מגיעות.";
      return null;
    case "SEPARATION":
      if ((p.entityIds?.length ?? 0) < 2) return "הפרדה היא בין שתי ישויות לפחות.";
      return null;
    default:
      return null;
  }
}

/// The ids of the client's entities the parameters point at, so the
/// server can make sure they are this client's.
export function entityIdsIn(p: PolicyParams): string[] {
  return [...new Set([p.entityId, ...(p.entityIds ?? [])].filter((x): x is string => !!x))];
}

/// A stable string, to tell whether parameters changed.
export function paramsKey(p: PolicyParams): string {
  const sorted = Object.fromEntries(
    Object.entries(p)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, Array.isArray(v) ? [...v].sort() : v])
  );
  return JSON.stringify(sorted);
}

/// The parameters that apply now, beside the rule's words (ruleInForce).
/// Approved: as written. Proposed with an interim rule: the interim
/// parameters, and when there are none, the careful reading of the
/// proposed ones: a proposed threshold is a threshold of zero, because the
/// permission it grants is the part not yet approved. Retired: nothing.
export function paramsInForce(r: {
  kind: PolicyKindLike;
  status: PolicyStatusLike;
  interimStatement: string | null;
  params: unknown;
  interimParams: unknown;
}): PolicyParams {
  if (r.status === "RETIRED") return {};
  const params = readParams(r.kind, r.params);
  if (r.status === "PROPOSED" && r.interimStatement?.trim()) {
    const interim = readParams(r.kind, r.interimParams);
    if (hasParams(interim)) return interim;
    if (r.kind === "THRESHOLD" && hasParams(params)) return { ...params, amountMinor: 0 };
  }
  return params;
}

export function formatAmount(minor: number, currency: string): string {
  const major = minor / 100;
  const n = Number.isInteger(major) ? major.toLocaleString("en-US") : major.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n} ${currency}`;
}

/// One line for a person: what the server checks. Null when nothing.
export function paramsSummary(kind: PolicyKindLike, p: PolicyParams, entityName: (id: string) => string): string | null {
  if (!hasParams(p)) return null;
  const on = (t?: ActionTag[]) => (t?.length ? t.map((x) => ACTION_TAG_LABELS[x]).join(", ") : null);
  const entity = p.entityId ? ` (${entityName(p.entityId)} בלבד)` : "";
  switch (kind) {
    case "THRESHOLD":
      return p.amountMinor !== undefined && p.currency
        ? `${on(p.appliesToTags) ?? "תשלום, רכישה, זיכוי"} מעל ${formatAmount(p.amountMinor, p.currency)} דורש שלב אישור${entity}`
        : null;
    case "APPROVAL_REQUIRED":
      return `${on(p.appliesToTags)} דורש שלב אישור לפני הביצוע${entity}`;
    case "FORBIDDEN":
      return `שלב של ${on(p.appliesToTags)} אסור${entity}`;
    case "REQUIRED_STEP":
      return `${p.appliesToTags?.length ? `בנוהל עם ${on(p.appliesToTags)}, ` : ""}אחד השלבים כולל "${p.mustInclude}"${entity}`;
    case "TIMING":
      return `${on(p.appliesToTags)}: לפחות ${p.leadBusinessDays} ימי עסקים לפני המועד${entity}`;
    case "COMMUNICATION": {
      const parts = [
        p.channels?.length ? `${on(p.appliesToTags) ?? "הודעה ללקוח"} רק ב: ${p.channels.map((c) => CHANNEL_LABELS[c]).join(", ")}` : null,
        p.invoiceTo?.length ? `חשבוניות של מערכות מגיעות רק ל: ${p.invoiceTo.join(", ")}` : null,
      ].filter(Boolean);
      return parts.length ? `${parts.join(". ")}${entity}` : null;
    }
    case "SEPARATION":
      return `הפרדה בין ${(p.entityIds ?? []).map(entityName).join(" ל-")}: שלב כספי משויך לישות, ואין גורם חיצוני של ישות אחרת`;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// The checks (spec 7.2)
// ---------------------------------------------------------------------------

/// BLOCK: never approved (R2). EXCEPTION: approved only while an approved
/// exception to that rule is in force (R7 to R10, R15).
export type RuleSeverity = "BLOCK" | "EXCEPTION";

export type RuleCheck = {
  code: string;
  message: string;
  step?: number;
  policyId: string;
  severity: RuleSeverity;
};

export type RuleForCheck = {
  id: string;
  title: string;
  kind: PolicyKindLike;
  /// paramsInForce(...) of the rule.
  params: PolicyParams;
};

export type ProcedureForCheck = {
  steps: ProcessStep[];
  /// The process's legal entity, if set.
  entityId: string | null;
  /// External parties on the process, with the entity each works with.
  externalParties: { name: string; entityId: string | null }[];
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

function applies(rule: RuleForCheck, entityId: string | null): boolean {
  // A rule of one entity binds that entity's procedures, and those with
  // no entity yet: until someone says whose it is, the careful reading.
  return !rule.params.entityId || !entityId || rule.params.entityId === entityId;
}

/// Whether a person approves at this step or before it.
function approvedBy(steps: ProcessStep[], i: number): boolean {
  return steps.slice(0, i + 1).some((s) => s.requiresApproval);
}

export function ruleChecks(proc: ProcedureForCheck, rules: RuleForCheck[]): RuleCheck[] {
  const out: RuleCheck[] = [];
  const { steps } = proc;
  for (const rule of rules) {
    const p = rule.params;
    if (!hasParams(p) || !applies(rule, proc.entityId)) continue;
    const base = { policyId: rule.id };
    const tagged = (t: ActionTag[] | undefined) => steps.map((s, i) => ({ s, i })).filter(({ s }) => s.actionTags.some((x) => (t ?? []).includes(x)));

    switch (rule.kind) {
      case "THRESHOLD": {
        if (p.amountMinor === undefined || !p.currency) break;
        for (const { s, i } of tagged(p.appliesToTags ?? MONEY_TAGS)) {
          // An amount we cannot compare is an amount that may be above.
          const known = s.amountMaxMinor !== null && s.currency === p.currency;
          if (known && s.amountMaxMinor! <= p.amountMinor) continue;
          if (approvedBy(steps, i)) continue;
          out.push({
            ...base,
            code: "R2",
            step: i + 1,
            severity: "BLOCK",
            message: `שלב ${i + 1}: ${known ? `עד ${formatAmount(s.amountMaxMinor!, s.currency!)}` : "בלי סכום מרבי במטבע של הכלל"}, מעל הסף של "${rule.title}" (${formatAmount(p.amountMinor, p.currency)}), ואין לפניו שלב אישור.`,
          });
        }
        break;
      }
      case "APPROVAL_REQUIRED":
        for (const { i } of tagged(p.appliesToTags)) {
          if (approvedBy(steps, i)) continue;
          out.push({ ...base, code: "R2", step: i + 1, severity: "BLOCK", message: `שלב ${i + 1}: לפי "${rule.title}" צריך אישור, ואין שלב אישור עד אליו.` });
        }
        break;
      case "REQUIRED_STEP": {
        if (!p.mustInclude) break;
        if (p.appliesToTags?.length && tagged(p.appliesToTags).length === 0) break;
        const want = norm(p.mustInclude);
        const found = steps.some((s) => [s.title, s.output, s.verification].some((t) => t && norm(t).includes(want)));
        if (!found) out.push({ ...base, code: "R7", severity: "EXCEPTION", message: `לפי "${rule.title}" אחד השלבים צריך לכלול "${p.mustInclude}".` });
        break;
      }
      case "SEPARATION": {
        const ids = p.entityIds ?? [];
        if (ids.length < 2) break;
        const money = tagged(MONEY_TAGS);
        if (money.length && !proc.entityId) {
          out.push({ ...base, code: "R8", step: money[0].i + 1, severity: "EXCEPTION", message: `לפי "${rule.title}" שלב כספי שייך לישות אחת, ולתהליך לא נבחרה ישות.` });
        }
        if (proc.entityId && ids.includes(proc.entityId)) {
          for (const party of proc.externalParties) {
            if (party.entityId && party.entityId !== proc.entityId && ids.includes(party.entityId)) {
              out.push({ ...base, code: "R8", severity: "EXCEPTION", message: `לפי "${rule.title}" ${party.name} עובד/ת עם ישות אחרת, ולא שותף/ה בתהליך של הישות הזו.` });
            }
          }
        }
        break;
      }
      case "TIMING": {
        if (!p.leadBusinessDays) break;
        for (const { s, i } of tagged(p.appliesToTags)) {
          if (s.offsetBusinessDays !== null && s.offsetBusinessDays <= -p.leadBusinessDays) continue;
          out.push({
            ...base,
            code: "R9",
            step: i + 1,
            severity: "EXCEPTION",
            message: `שלב ${i + 1}: לפי "${rule.title}" לפחות ${p.leadBusinessDays} ימי עסקים לפני המועד${s.offsetBusinessDays === null ? ", ולשלב אין יום" : `, והשלב ב-${s.offsetBusinessDays}`}.`,
          });
        }
        break;
      }
      case "COMMUNICATION": {
        if (!p.channels?.length) break;
        for (const { s, i } of tagged(p.appliesToTags ?? ["CLIENT_MESSAGE"])) {
          if (s.channel && p.channels.includes(s.channel)) continue;
          out.push({
            ...base,
            code: "R10",
            step: i + 1,
            severity: "EXCEPTION",
            message: `שלב ${i + 1}: לפי "${rule.title}" רק ב: ${p.channels.map((c) => CHANNEL_LABELS[c]).join(", ")}${s.channel ? `, והשלב ב-${CHANNEL_LABELS[s.channel]}` : ", ולשלב לא נבחר ערוץ"}.`,
          });
        }
        break;
      }
      case "FORBIDDEN":
        for (const { s, i } of tagged(p.appliesToTags)) {
          const which = s.actionTags.filter((t) => p.appliesToTags!.includes(t)).map((t) => ACTION_TAG_LABELS[t]).join(", ");
          out.push({ ...base, code: "R15", step: i + 1, severity: "EXCEPTION", message: `שלב ${i + 1}: ${which} אסור לפי "${rule.title}".` });
        }
        break;
      default:
        break;
    }
  }
  return out;
}

/// Whether an invoice address matches what the rule allows: the same
/// address, or an address at an allowed domain.
export function invoiceAllowed(address: string, allowed: string[]): boolean {
  const a = address.trim().toLowerCase();
  if (!a) return false;
  const domain = a.includes("@") ? a.split("@").pop()! : null;
  return allowed.some((x) => x === a || (!x.includes("@") && domain === x));
}

/// R16: systems with a bill whose invoice does not arrive where the
/// client's rule says. A gap, not a block: it is about the system map, and
/// the fix is to change where the bill goes.
export function invoiceGaps(
  systems: { id: string; systemName: string; invoiceTo: string | null; billed: boolean; entityId: string | null }[],
  rules: RuleForCheck[]
): { systemId: string; policyId: string; message: string }[] {
  const out: { systemId: string; policyId: string; message: string }[] = [];
  for (const rule of rules) {
    const allowed = rule.kind === "COMMUNICATION" ? rule.params.invoiceTo : undefined;
    if (!allowed?.length) continue;
    for (const s of systems) {
      if (!s.billed && !s.invoiceTo) continue;
      if (!applies(rule, s.entityId)) continue;
      if (s.invoiceTo && invoiceAllowed(s.invoiceTo, allowed)) continue;
      out.push({
        systemId: s.id,
        policyId: rule.id,
        message: `${s.systemName}: ${s.invoiceTo ? `החשבונית מגיעה ל-${s.invoiceTo}` : "לא ידוע לאן החשבונית מגיעה"}, ולפי "${rule.title}" רק ל: ${allowed.join(", ")}.`,
      });
    }
  }
  return out;
}

/// Request types that route to a contact of another entity (R8, the
/// "Inc invoice to Ayala" case).
export function requestTypeConflicts(
  types: { id: string; title: string; entityId: string | null; routes: { name: string; entityId: string | null }[] }[],
  rules: RuleForCheck[]
): { requestTypeId: string; policyId: string; message: string }[] {
  const out: { requestTypeId: string; policyId: string; message: string }[] = [];
  for (const rule of rules) {
    const ids = rule.kind === "SEPARATION" ? rule.params.entityIds : undefined;
    if (!ids || ids.length < 2) continue;
    for (const t of types) {
      if (!t.entityId || !ids.includes(t.entityId)) continue;
      for (const r of t.routes) {
        if (r.entityId && r.entityId !== t.entityId && ids.includes(r.entityId)) {
          out.push({ requestTypeId: t.id, policyId: rule.id, message: `${t.title}: מפנים ל-${r.name}, שעובד/ת עם ישות אחרת, בניגוד ל"${rule.title}".` });
        }
      }
    }
  }
  return out;
}
