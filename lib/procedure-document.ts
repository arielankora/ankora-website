// A client's procedure as a document (23.10.2026): the shape a SOC 2
// policy has when an organisation keeps it in Word, built from the process
// and its version instead of typed into a file. One builder, three
// outputs: the read view, the PDF and the Word file all draw the blocks
// made here, so what an auditor downloads is what the screen shows.
//
// Pure: no database, no Node APIs. The screen, the routes and the tests
// read a procedure document the same way.

import { readSteps, STEP_MODE_LABELS, TRIGGER_LABELS, CHANNEL_LABELS, type ProcessStep, type StepModeLike, type TriggerLike, type Channel } from "@/lib/process-rules";
import { formatMinor } from "@/lib/money";

/// A step's ceiling: shekels as the product writes them, another currency
/// by its code ("1,500 USD").
function amountText(minor: number, currency: string | null): string {
  if (!currency || currency === "ILS") return formatMinor(minor) ?? String(minor);
  const n = minor / 100;
  return `${n.toLocaleString("en-US", { maximumFractionDigits: Number.isInteger(n) ? 0 : 2, minimumFractionDigits: Number.isInteger(n) ? 0 : 2 })} ${currency}`;
}

export type ProcedureLang = "he" | "en";
export type ClassificationLike = "PUBLIC" | "INTERNAL" | "CONFIDENTIAL";

// ---------------------------------------------------------------------------
// The snapshot: the process's fields, names resolved, frozen when a
// version is approved (ProcessVersion.document).
// ---------------------------------------------------------------------------

export type ProcedureSnapshot = {
  v: 1 | 2;
  frozenAt: string;
  /// What froze it: the approval, or a translation saved for a version
  /// approved before snapshots existed.
  frozenBy: "approval" | "translation";
  clientName: string;
  code: string;
  title: string;
  purpose: string | null;
  scope: string | null;
  definitions: string | null;
  triggerKinds: TriggerLike[];
  triggerText: string | null;
  slaText: string | null;
  owner: string | null;
  backupOwner: string | null;
  executor: string | null;
  approver: string | null;
  approvalText: string | null;
  externalParty: string | null;
  /// Systems the process needs, with the permission each needs.
  systems: { name: string; permission: string | null }[];
  /// Names for the system ids its steps use.
  systemNames: Record<string, string>;
  exceptionPlaybook: string | null;
  controlRefs: string[];
  classification: ClassificationLike;
  relatedDocs: string | null;
  reviewEveryDays: number | null;
  /// The three role fields as their parts, so the contacts in them can be
  /// looked at again every time the document is read (v2, 25.10.2026).
  /// Null on a v1 snapshot, which froze only the joined text.
  people: SnapshotPeople | null;
};

/**
 * Who a role names, kept apart rather than pre-joined.
 *
 * The joined strings above are what the document prints. They are built
 * from these, and the contact parts are rebuilt on every read.
 *
 * Why the ids and not just the names. A contact's sensitivity is not a
 * property of the version, it is a property of the person: somebody marks
 * a contact sensitive precisely to stop their name leaving the product,
 * and that decision has to reach documents approved before they made it.
 * A frozen name cannot be re-checked against anything. An id can.
 *
 * The content of a version stays frozen; only who may be named in it is
 * answered now instead of then.
 */
export type SnapshotPeople = {
  executorUser: string | null;
  executorContactId: string | null;
  executorText: string | null;
  approverUser: string | null;
  approverContactId: string | null;
  approverText: string | null;
  externalPartyContactIds: string[];
  externalPartyText: string | null;
};

/// The three role fields built from contacts, and so re-checked on read.
export const PEOPLE_FIELDS = ["executor", "approver", "externalParty"] as const;
export type PeopleField = (typeof PEOPLE_FIELDS)[number];

const str = (v: unknown, max = 5000): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/// How a role line is assembled from its parts, in one place, so that a
/// read rebuilds it exactly the way the approval wrote it.
export function joinParts(parts: (string | null | undefined)[]): string | null {
  return parts.filter((p): p is string => !!p && !!p.trim()).join(". ") || null;
}

function readPeople(value: unknown): SnapshotPeople | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const ids = Array.isArray(v.externalPartyContactIds)
    ? (v.externalPartyContactIds as unknown[]).filter((x): x is string => typeof x === "string" && !!x).slice(0, 50)
    : [];
  return {
    executorUser: str(v.executorUser, 200),
    executorContactId: str(v.executorContactId, 60),
    executorText: str(v.executorText, 500),
    approverUser: str(v.approverUser, 200),
    approverContactId: str(v.approverContactId, 60),
    approverText: str(v.approverText, 500),
    externalPartyContactIds: ids,
    externalPartyText: str(v.externalPartyText, 500),
  };
}

export function readSnapshot(value: unknown): ProcedureSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  // v1 and v2 both read. v2 adds `people` (see SnapshotPeople); a v1
  // snapshot has no contact ids of its own, and the caller falls back to
  // the ones the process carries now.
  if ((v.v !== 1 && v.v !== 2) || !str(v.title) || !str(v.code)) return null;
  const triggers = Array.isArray(v.triggerKinds) ? (v.triggerKinds as unknown[]).filter((t): t is TriggerLike => typeof t === "string" && t in TRIGGER_LABELS) : [];
  const systems = Array.isArray(v.systems)
    ? (v.systems as unknown[])
        .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
        .map((x) => ({ name: str(x.name, 200) ?? "", permission: str(x.permission, 500) }))
        .filter((x) => x.name)
    : [];
  const names: Record<string, string> = {};
  if (v.systemNames && typeof v.systemNames === "object") {
    for (const [k, n] of Object.entries(v.systemNames as Record<string, unknown>)) if (typeof n === "string") names[k] = n;
  }
  return {
    v: v.v === 2 ? 2 : 1,
    frozenAt: str(v.frozenAt) ?? new Date(0).toISOString(),
    frozenBy: v.frozenBy === "translation" ? "translation" : "approval",
    clientName: str(v.clientName, 200) ?? "",
    code: str(v.code, 20)!,
    title: str(v.title, 300)!,
    purpose: str(v.purpose),
    scope: str(v.scope),
    definitions: str(v.definitions),
    triggerKinds: triggers,
    triggerText: str(v.triggerText),
    slaText: str(v.slaText),
    owner: str(v.owner, 200),
    backupOwner: str(v.backupOwner, 200),
    executor: str(v.executor, 500),
    approver: str(v.approver, 500),
    approvalText: str(v.approvalText),
    externalParty: str(v.externalParty, 500),
    systems,
    systemNames: names,
    exceptionPlaybook: str(v.exceptionPlaybook),
    controlRefs: readControlRefs(v.controlRefs),
    classification: v.classification === "PUBLIC" || v.classification === "INTERNAL" ? v.classification : "CONFIDENTIAL",
    relatedDocs: str(v.relatedDocs),
    reviewEveryDays: typeof v.reviewEveryDays === "number" && v.reviewEveryDays > 0 ? Math.round(v.reviewEveryDays) : null,
    people: readPeople(v.people),
  };
}

/// Control codes as typed ("CC6.2, CC6.3" or a list), trimmed, deduped,
/// at most 30. A code is letters, digits, dots and dashes, up to 20
/// characters; anything else is dropped rather than printed.
export function readControlRefs(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,\n]/) : [];
  const out: string[] = [];
  for (const r of raw) {
    if (typeof r !== "string") continue;
    const t = r.trim().replace(/\s+/g, " ");
    if (!t || t.length > 20 || !/^[A-Za-z0-9][A-Za-z0-9.\-_ ]*$/.test(t)) continue;
    if (!out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
    if (out.length >= 30) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The English translation of one version's document.
// ---------------------------------------------------------------------------

/// The free-text fields of the snapshot and the version, in English.
/// Codes, dates and enum labels are not here: the builder translates
/// those itself.
export type ProcedureTranslation = {
  title: string;
  purpose?: string | null;
  scope?: string | null;
  definitions?: string | null;
  triggerText?: string | null;
  slaText?: string | null;
  owner?: string | null;
  backupOwner?: string | null;
  executor?: string | null;
  approver?: string | null;
  approvalText?: string | null;
  externalParty?: string | null;
  systems?: { name: string; permission?: string | null }[];
  exceptionPlaybook?: string | null;
  relatedDocs?: string | null;
  steps: { title: string; output?: string | null; verification?: string | null }[];
  highlights?: string | null;
  outputs?: string | null;
  /// Version number -> its change note, for the revision history.
  changeNotes?: Record<string, string>;
  /// Names as they should appear in English, for people in the history
  /// ("הדס" -> "Hadas Vinogura").
  names?: Record<string, string>;
};

/// The snapshot fields a translation must cover when the Hebrew has them.
export const TRANSLATED_FIELDS = [
  "purpose",
  "scope",
  "definitions",
  "triggerText",
  "slaText",
  "owner",
  "backupOwner",
  "executor",
  "approver",
  "approvalText",
  "externalParty",
  "exceptionPlaybook",
  "relatedDocs",
] as const;

export function readTranslation(value: unknown): ProcedureTranslation | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const title = str(v.title, 300);
  if (!title || !Array.isArray(v.steps)) return null;
  const out: ProcedureTranslation = {
    title,
    steps: (v.steps as unknown[]).map((s) => {
      const r = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
      return { title: str(r.title, 300) ?? "", output: str(r.output, 1000), verification: str(r.verification, 1000) };
    }),
  };
  for (const k of TRANSLATED_FIELDS) out[k] = str(v[k]);
  out.highlights = str(v.highlights);
  out.outputs = str(v.outputs);
  if (Array.isArray(v.systems)) {
    out.systems = (v.systems as unknown[])
      .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
      .map((x) => ({ name: str(x.name, 200) ?? "", permission: str(x.permission, 500) }));
  }
  for (const key of ["changeNotes", "names"] as const) {
    if (v[key] && typeof v[key] === "object") {
      const m: Record<string, string> = {};
      for (const [k, n] of Object.entries(v[key] as Record<string, unknown>)) if (typeof n === "string" && n.trim()) m[k] = n.trim().slice(0, 1000);
      out[key] = m;
    }
  }
  return out;
}

/// What a translation leaves untranslated: every field the Hebrew has and
/// the English does not, by name. Empty means it is complete. A document
/// that is half English is not exported, so this is what the MCP tool
/// answers with and what the approve button waits for.
export function translationGaps(
  snapshot: ProcedureSnapshot,
  version: { steps: ProcessStep[]; highlights: string | null; outputs: string | null },
  tr: ProcedureTranslation
): string[] {
  const gaps: string[] = [];
  for (const k of TRANSLATED_FIELDS) if (snapshot[k] && !tr[k]) gaps.push(k);
  if (version.highlights && !tr.highlights) gaps.push("highlights");
  if (version.outputs && !tr.outputs) gaps.push("outputs");
  if (tr.steps.length !== version.steps.length) gaps.push(`steps (expected ${version.steps.length}, got ${tr.steps.length})`);
  version.steps.forEach((st, i) => {
    const t = tr.steps[i];
    if (!t) return;
    if (!t.title) gaps.push(`steps[${i}].title`);
    if (st.output && !t.output) gaps.push(`steps[${i}].output`);
    if (st.verification && !t.verification) gaps.push(`steps[${i}].verification`);
  });
  if (snapshot.systems.length && (tr.systems?.length ?? 0) !== snapshot.systems.length) gaps.push(`systems (expected ${snapshot.systems.length})`);
  // Hebrew left in an English document is the gap a field check misses.
  const hebrew = /[֐-׿]/;
  const leftovers = Object.entries(flatten(tr)).filter(([k, val]) => !k.startsWith("names.") && hebrew.test(val));
  for (const [k] of leftovers) gaps.push(`${k} (still in Hebrew)`);
  return gaps;
}

function flatten(tr: ProcedureTranslation): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (prefix: string, v: unknown) => {
    if (typeof v === "string") out[prefix] = v;
    else if (Array.isArray(v)) v.forEach((x, i) => walk(`${prefix}[${i}]`, x));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(prefix ? `${prefix}.${k}` : k, x);
  };
  walk("", tr);
  return out;
}

// ---------------------------------------------------------------------------
// The document.
// ---------------------------------------------------------------------------

export type VersionStatusLike = "DRAFT" | "APPROVED" | "SUPERSEDED";

export type ProcedureVersionInfo = {
  version: number;
  status: VersionStatusLike;
  steps: unknown;
  highlights: string | null;
  outputs: string | null;
  changeNote: string | null;
  createdAt: Date;
  approvedAt: Date | null;
  approvedBy: string | null;
};

export type HistoryRow = { version: number; status: VersionStatusLike; approvedAt: Date | null; approvedBy: string | null; changeNote: string | null };

/// Everything a renderer draws. `blocks` is the body; `meta` the header
/// table; `footer` the line under every page.
export type DocBlock =
  | { kind: "heading"; level: 1 | 2; text: string }
  | { kind: "para"; text: string; muted?: boolean }
  | { kind: "bullets"; items: string[] }
  | { kind: "table"; header: string[]; rows: string[][]; weights?: number[] };

export type ProcedureDoc = {
  lang: ProcedureLang;
  dir: "rtl" | "ltr";
  docId: string;
  title: string;
  clientName: string;
  meta: [string, string][];
  blocks: DocBlock[];
  footer: string;
  /// Shown as a note in the read view and the files: drawn from the live
  /// process, because the version predates frozen documents.
  liveNote: string | null;
  /// Sections with nothing in them, for the read view to point at.
  gaps: string[];
  status: VersionStatusLike;
  version: number;
};

const L = {
  he: {
    docId: "מזהה מסמך",
    version: "גרסה",
    status: "סטטוס",
    effective: "בתוקף מ-",
    owner: "בעל הנוהל",
    approvedBy: "אושר על ידי",
    nextReview: "סקירה הבאה",
    classification: "סיווג",
    client: "ארגון",
    statusLabels: { DRAFT: "טיוטה", APPROVED: "מאושר ובתוקף", SUPERSEDED: "הוחלף בגרסה חדשה" } as Record<VersionStatusLike, string>,
    classLabels: { PUBLIC: "ציבורי", INTERNAL: "פנימי", CONFIDENTIAL: "סודי" } as Record<ClassificationLike, string>,
    purpose: "מטרה",
    scope: "תחולה",
    definitions: "הגדרות",
    roles: "תפקידים ואחריות",
    rolesHeader: ["תפקיד", "מי"],
    roleOwner: "בעל הנוהל, אחראי לעדכונו ולביצועו",
    roleBackup: "גיבוי",
    roleExecutor: "מבצע",
    roleApprover: "מאשר",
    roleExternal: "גורם חיצוני",
    peopleWithheld: "שם של איש קשר הושמט מהמסמך לפי סימון הרגישות שלו בתיק הלקוח.",
    trigger: "הפעלה וזמני תגובה",
    triggerWhen: "מתי",
    triggerKinds: "סוג הפעלה",
    sla: "זמן תגובה (SLA)",
    systems: "מערכות והרשאות",
    systemsHeader: ["מערכת", "הרשאה נדרשת"],
    procedure: "הנוהל",
    stepMode: "אופן ביצוע",
    stepTiming: "מתי",
    stepSystems: "מערכות",
    stepOutput: "תוצר",
    stepVerification: "אימות",
    stepApproval: "דורש אישור לפני ביצוע",
    stepAmount: "סכום מרבי",
    stepChannel: "ערוץ",
    dayOf: (n: number) => (n === 0 ? "ביום המועד" : n < 0 ? `${-n} ימי עסקים לפני המועד` : `${n} ימי עסקים אחרי המועד`),
    modes: STEP_MODE_LABELS as Record<StepModeLike, string>,
    triggers: TRIGGER_LABELS as Record<TriggerLike, string>,
    channels: CHANNEL_LABELS as Record<Channel, string>,
    highlights: "דגשים",
    exceptions: "חריגות והסלמה",
    approvals: "ספי אישור",
    records: "תיעוד וראיות",
    recordsDone: "ריצה נחשבת גמורה כש:",
    recordsSteps: "תוצרים לפי שלב:",
    step: "שלב",
    controls: "מיפוי לבקרות",
    controlsNote: "הבקרות שהנוהל הזה משמש להן ראיה.",
    related: "מסמכים קשורים",
    history: "היסטוריית גרסאות",
    historyHeader: ["גרסה", "תאריך אישור", "אושר על ידי", "מה השתנה"],
    notApproved: "לא אושרה",
    approval: "אישור המסמך",
    approvalLine: (by: string, at: string) => `הגרסה אושרה על ידי ${by} ב-${at}.`,
    draftLine: "טיוטה. הגרסה הזו עדיין לא אושרה, ואינה בתוקף.",
    fingerprintLine: "טביעת המסמך (SHA-256, לאימות מול המערכת):",
    liveNote: "הגרסה אושרה לפני שמסמכי נוהל נשמרו כתמונה. הפרטים שמחוץ לשלבים נלקחו מהתהליך כפי שהוא היום.",
    defaultScope: null as string | null,
    none: "לא הוגדר",
  },
  en: {
    docId: "Document ID",
    version: "Version",
    status: "Status",
    effective: "Effective date",
    owner: "Policy owner",
    approvedBy: "Approved by",
    nextReview: "Next review",
    classification: "Classification",
    client: "Organization",
    statusLabels: { DRAFT: "Draft", APPROVED: "Approved, in effect", SUPERSEDED: "Superseded" } as Record<VersionStatusLike, string>,
    classLabels: { PUBLIC: "Public", INTERNAL: "Internal", CONFIDENTIAL: "Confidential" } as Record<ClassificationLike, string>,
    purpose: "Purpose",
    scope: "Scope",
    definitions: "Definitions",
    roles: "Roles and responsibilities",
    rolesHeader: ["Role", "Who"],
    roleOwner: "Policy owner, accountable for its upkeep and execution",
    roleBackup: "Backup",
    roleExecutor: "Executor",
    roleApprover: "Approver",
    roleExternal: "External party",
    peopleWithheld: "A contact's name is withheld from this document, per their sensitivity marking in the client file.",
    trigger: "Trigger and service level",
    triggerWhen: "When",
    triggerKinds: "Trigger type",
    sla: "Service level (SLA)",
    systems: "Systems and access",
    systemsHeader: ["System", "Required permission"],
    procedure: "Procedure",
    stepMode: "Performed",
    stepTiming: "When",
    stepSystems: "Systems",
    stepOutput: "Output",
    stepVerification: "Verification",
    stepApproval: "Requires approval before execution",
    stepAmount: "Maximum amount",
    stepChannel: "Channel",
    dayOf: (n: number) => (n === 0 ? "On the scheduled date" : n < 0 ? `${-n} business day${n === -1 ? "" : "s"} before the scheduled date` : `${n} business day${n === 1 ? "" : "s"} after the scheduled date`),
    modes: { MANUAL: "Manually", ASSISTED: "Prepared by AI, reviewed by a person", AUTOMATED: "Automatically" } as Record<StepModeLike, string>,
    triggers: { SCHEDULED: "Scheduled", EVENT: "Event-driven", ON_DEMAND: "On request", CONTINUOUS: "Ongoing" } as Record<TriggerLike, string>,
    channels: { EMAIL: "Email", WHATSAPP: "WhatsApp", SLACK: "Slack", PHONE: "Phone", PORTAL: "Client portal", OTHER: "Other" } as Record<Channel, string>,
    highlights: "Key points",
    exceptions: "Exceptions and escalation",
    approvals: "Approval thresholds",
    records: "Records and evidence",
    recordsDone: "A run is complete when:",
    recordsSteps: "Output by step:",
    step: "Step",
    controls: "Control mapping",
    controlsNote: "The controls this procedure provides evidence for.",
    related: "Related documents",
    history: "Revision history",
    historyHeader: ["Version", "Approved on", "Approved by", "Changes"],
    notApproved: "Not approved",
    approval: "Document approval",
    approvalLine: (by: string, at: string) => `This version was approved by ${by} on ${at}.`,
    draftLine: "Draft. This version has not been approved and is not in effect.",
    fingerprintLine: "Document fingerprint (SHA-256, to verify against the system of record):",
    liveNote: "This version was approved before procedure documents were frozen at approval. Details outside the steps are taken from the process as it stands today.",
    defaultScope: null as string | null,
    none: "Not defined",
  },
};

export function labels(lang: ProcedureLang) {
  return L[lang];
}

export function dateText(d: Date | null, lang: ProcedureLang): string {
  if (!d) return "";
  return new Intl.DateTimeFormat(lang === "he" ? "he-IL" : "en-GB", { day: "numeric", month: lang === "he" ? "numeric" : "short", year: "numeric", timeZone: "Asia/Jerusalem" }).format(d);
}

/// Lines of a Markdown-ish field as paragraphs and bullets: "- x" and
/// "• x" lines become bullets, everything else a paragraph, and "**" is
/// dropped (the documents have no inline formatting).
export function textBlocks(text: string): DocBlock[] {
  const out: DocBlock[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) out.push({ kind: "bullets", items: bullets });
    bullets = [];
  };
  for (const raw of text.replace(/\*\*/g, "").split(/\n/)) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const m = line.match(/^(?:[-•*]|\d+[.)])\s+(.*)$/);
    if (m) bullets.push(m[1]);
    else {
      flush();
      out.push({ kind: "para", text: line });
    }
  }
  flush();
  return out;
}

/// "term: meaning" lines as a two-column table; a line without a colon is
/// its own row with an empty meaning.
function definitionRows(text: string): string[][] {
  return text
    .split(/\n/)
    .map((l) => l.trim().replace(/^[-•*]\s+/, ""))
    .filter(Boolean)
    .map((l) => {
      const i = l.search(/[:：]/);
      return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : [l, ""];
    });
}

export type BuildInput = {
  lang: ProcedureLang;
  snapshot: ProcedureSnapshot;
  version: ProcedureVersionInfo;
  history: HistoryRow[];
  /// Required for `lang: "en"`.
  translation?: ProcedureTranslation | null;
  /// The snapshot was built from the live process, not frozen.
  live: boolean;
  /// Leave sections with nothing in them out (the files); the read view
  /// keeps them, marked, so a gap is seen.
  omitEmpty: boolean;
  /// Role fields a contact was taken out of, because that contact is
  /// marked sensitive or kept to a few people today. Empty is the normal
  /// case. The document says so rather than quietly printing one name
  /// fewer: a reader who cannot tell the difference between "nobody" and
  /// "withheld" is a reader the document has misled, and an auditor is
  /// exactly that reader.
  withheldPeople?: readonly PeopleField[];
};

export function buildProcedureDoc(input: BuildInput): ProcedureDoc {
  const { lang, version, history, live, omitEmpty } = input;
  const t = labels(lang);
  const withheld = input.withheldPeople ?? [];
  let tr = lang === "en" ? input.translation ?? null : null;
  if (lang === "en" && !tr) throw new Error("An English document needs an approved translation.");
  // The English text was translated from the Hebrew as it read before the
  // contact was marked. Taking the name out of one language only would
  // publish it in the other, which is not a smaller leak, it is the same
  // leak in a document that claims to be the translation of a document
  // without it.
  if (tr && withheld.length) {
    tr = { ...tr };
    for (const k of withheld) tr[k] = null;
  }
  const snap = input.snapshot;
  const steps = readSteps(version.steps);
  // A field in the document's language: the translation's when English.
  const f = <K extends (typeof TRANSLATED_FIELDS)[number]>(k: K): string | null => (tr ? tr[k] ?? null : snap[k]);
  const name = (n: string | null) => (n && tr?.names?.[n]) || n;

  const docId = `${snap.code}`;
  const title = tr ? tr.title : snap.title;
  const reviewDue = version.approvedAt && snap.reviewEveryDays ? new Date(version.approvedAt.getTime() + snap.reviewEveryDays * 86400000) : null;

  const meta: [string, string][] = [
    [t.client, snap.clientName],
    [t.docId, `${docId}`],
    [t.version, String(version.version)],
    [t.status, t.statusLabels[version.status]],
    [t.effective, version.status === "DRAFT" ? "" : dateText(version.approvedAt, lang)],
    [t.owner, name(f("owner")) ?? ""],
    [t.approvedBy, version.status === "DRAFT" ? "" : name(version.approvedBy) ?? ""],
    [t.nextReview, dateText(reviewDue, lang)],
    [t.classification, t.classLabels[snap.classification]],
  ];

  type Section = { key: string; title: string; body: DocBlock[] };
  const sections: Section[] = [];
  const gaps: string[] = [];
  const add = (key: string, title: string, body: DocBlock[]) => {
    if (body.length === 0) {
      gaps.push(title);
      if (omitEmpty) return;
      body = [{ kind: "para", text: t.none, muted: true }];
    }
    sections.push({ key, title, body });
  };

  const purpose = f("purpose");
  add("purpose", t.purpose, purpose ? textBlocks(purpose) : []);
  const scope = f("scope");
  add("scope", t.scope, scope ? textBlocks(scope) : []);
  const defs = f("definitions");
  add("definitions", t.definitions, defs ? [{ kind: "table", header: [], rows: definitionRows(defs), weights: [1, 2] }] : []);

  const roles: string[][] = [];
  if (f("owner")) roles.push([t.roleOwner, name(f("owner"))!]);
  if (f("backupOwner")) roles.push([t.roleBackup, name(f("backupOwner"))!]);
  if (f("executor")) roles.push([t.roleExecutor, f("executor")!]);
  if (f("approver")) roles.push([t.roleApprover, f("approver")!]);
  if (f("externalParty")) roles.push([t.roleExternal, f("externalParty")!]);
  const rolesBody: DocBlock[] = roles.length ? [{ kind: "table", header: t.rolesHeader, rows: roles, weights: [1, 2] }] : [];
  if (withheld.length) rolesBody.push({ kind: "para", text: t.peopleWithheld, muted: true });
  add("roles", t.roles, rolesBody);

  const trig: string[][] = [];
  if (snap.triggerKinds.length) trig.push([t.triggerKinds, snap.triggerKinds.map((k) => t.triggers[k]).join(", ")]);
  if (f("triggerText")) trig.push([t.triggerWhen, f("triggerText")!]);
  if (f("slaText")) trig.push([t.sla, f("slaText")!]);
  add("trigger", t.trigger, trig.length ? [{ kind: "table", header: [], rows: trig, weights: [1, 2] }] : []);

  const systems = snap.systems.map((s, i) => [tr?.systems?.[i]?.name || s.name, (tr ? tr.systems?.[i]?.permission : s.permission) || ""]);
  add("systems", t.systems, systems.length ? [{ kind: "table", header: t.systemsHeader, rows: systems, weights: [1, 2] }] : []);

  const procedure: DocBlock[] = [];
  steps.forEach((st, i) => {
    const ts = tr?.steps[i];
    procedure.push({ kind: "heading", level: 2, text: `${i + 1}. ${ts?.title || st.title}` });
    const rows: string[][] = [[t.stepMode, t.modes[st.mode]]];
    if (st.offsetBusinessDays !== null) rows.push([t.stepTiming, t.dayOf(st.offsetBusinessDays)]);
    const sys = st.systemIds.map((id) => snap.systemNames[id]).filter(Boolean);
    if (sys.length) rows.push([t.stepSystems, sys.join(", ")]);
    const output = tr ? ts?.output : st.output;
    if (output) rows.push([t.stepOutput, output]);
    const verification = tr ? ts?.verification : st.verification;
    if (verification) rows.push([t.stepVerification, verification]);
    if (st.requiresApproval) rows.push([t.stepApproval, lang === "he" ? "כן" : "Yes"]);
    if (st.amountMaxMinor !== null) rows.push([t.stepAmount, amountText(st.amountMaxMinor, st.currency)]);
    if (st.channel) rows.push([t.stepChannel, t.channels[st.channel]]);
    procedure.push({ kind: "table", header: [], rows, weights: [1, 3] });
  });
  add("procedure", t.procedure, procedure);

  const highlights = tr ? tr.highlights ?? null : version.highlights;
  add("highlights", t.highlights, highlights ? textBlocks(highlights) : []);

  const exceptions: DocBlock[] = [];
  const playbook = f("exceptionPlaybook");
  if (playbook) exceptions.push(...textBlocks(playbook));
  const approvalText = f("approvalText");
  if (approvalText) exceptions.push({ kind: "para", text: `${t.approvals}: ${approvalText}` });
  add("exceptions", t.exceptions, exceptions);

  const records: DocBlock[] = [];
  const outputs = tr ? tr.outputs ?? null : version.outputs;
  if (outputs) records.push({ kind: "para", text: t.recordsDone }, ...textBlocks(outputs));
  const stepOutputs = steps
    .map((st, i) => ({ n: i + 1, out: tr ? tr.steps[i]?.output : st.output }))
    .filter((x) => x.out)
    .map((x) => `${t.step} ${x.n}: ${x.out}`);
  if (stepOutputs.length) records.push({ kind: "para", text: t.recordsSteps }, { kind: "bullets", items: stepOutputs });
  add("records", t.records, records);

  add("controls", t.controls, snap.controlRefs.length ? [{ kind: "para", text: t.controlsNote, muted: true }, { kind: "bullets", items: snap.controlRefs }] : []);
  const related = f("relatedDocs");
  add("related", t.related, related ? textBlocks(related) : []);

  const histRows = [...history]
    .sort((a, b) => b.version - a.version)
    .map((h) => [
      String(h.version),
      h.approvedAt ? dateText(h.approvedAt, lang) : t.notApproved,
      name(h.approvedBy) ?? "",
      (tr ? tr.changeNotes?.[String(h.version)] : h.changeNote) ?? "",
    ]);
  add("history", t.history, histRows.length ? [{ kind: "table", header: t.historyHeader, rows: histRows, weights: [0.6, 1, 1.2, 3] }] : []);

  const blocks: DocBlock[] = [];
  sections.forEach((s, i) => {
    blocks.push({ kind: "heading", level: 1, text: `${i + 1}. ${s.title}` });
    blocks.push(...s.body);
  });
  // The approval section closes the document and is never empty.
  blocks.push({ kind: "heading", level: 1, text: `${sections.length + 1}. ${t.approval}` });
  blocks.push({
    kind: "para",
    text: version.status === "DRAFT" || !version.approvedAt ? t.draftLine : t.approvalLine(name(version.approvedBy) ?? "", dateText(version.approvedAt, lang)),
  });

  const status = lang === "he" ? t.statusLabels[version.status] : t.statusLabels[version.status].toUpperCase();
  return {
    lang,
    dir: lang === "he" ? "rtl" : "ltr",
    docId,
    title,
    clientName: snap.clientName,
    meta,
    blocks,
    footer: `${snap.clientName} · ${docId} v${version.version} · ${version.status === "APPROVED" ? t.classLabels[snap.classification] : status}`,
    liveNote: live ? t.liveNote : null,
    gaps,
    status: version.status,
    version: version.version,
  };
}

/// The text a fingerprint is taken over: the header and the body, without
/// the generation date, so the same version prints the same fingerprint
/// in every format and on every day.
export function fingerprintSource(doc: ProcedureDoc): string {
  return JSON.stringify({ lang: doc.lang, title: doc.title, meta: doc.meta, blocks: doc.blocks });
}

/// The closing line of the files, under the approval section.
export function fingerprintBlock(doc: ProcedureDoc, hash: string): DocBlock[] {
  return [
    { kind: "para", text: labels(doc.lang).fingerprintLine, muted: true },
    { kind: "para", text: hash, muted: true },
  ];
}

/// A file name that says what it is: "NUX P1 v2 ניהול משתמשים.pdf".
export function procedureFileName(doc: ProcedureDoc, ext: "pdf" | "docx"): string {
  const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return `${safe(doc.clientName)} ${doc.docId} v${doc.version} ${safe(doc.title)}${doc.lang === "en" ? " (EN)" : ""}.${ext}`;
}
