import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma, User, SourceKind, SourceRestriction, SourceWeight, TaskPriority } from "@prisma/client";
import { assertCan, canManageClients } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { findSecrets } from "@/lib/secret-scan";
import { normalizeDomain, normalizeEmail } from "@/lib/contact-normalize";
import { defaultWeight, readSourceRefs, sourceCode, type SourceRef } from "@/lib/knowledge-sources";
import {
  PAYLOADS,
  normalizeForMatch,
  payloadText,
  proposalHeadline,
  proposalProblems,
  type ProposalActionLike,
  type ProposalFlag,
  type ProposalTargetLike,
  bulkApproveBlocker,
  MAX_BULK,
  missingRequired,
  resolveKnowledgeStatus,
  CONFIDENCE_LEVELS,
  type ConfidenceLike,
  firefliesLink,
  taskBlocker,
  taskFromProposal,
  TASK_TITLE_MAX,
  actionTitle,
  defaultTaskDue,
  isQuestionTitle,
  taskTitleProblem,
} from "@/lib/knowledge-proposals";
import { localDateKey } from "@/lib/timezone";
import { addClientDomain, addClientSource, assertClientAccess } from "@/lib/app-domain/client-sources";
import { addClientEntity } from "@/lib/app-domain/client-entities";
import { NarrativeConflictError, saveNarrative } from "@/lib/app-domain/client-narratives";
import { addProcess, linkProcessDates, saveProcessVersion } from "@/lib/app-domain/processes";
import { addClientContact, addClientOrganization } from "@/lib/app-domain/client-contacts";
import { addClientFact, addClientFactSources, answerClientQuestion, recordContradiction, supersedeClientFact } from "@/lib/app-domain/client-facts";
import { FACT_KIND_LABELS, isQuestion, type FactKindLike } from "@/lib/client-facts";
import { addSystemAccess } from "@/lib/app-domain/system-map";
import { addRequestType } from "@/lib/app-domain/request-types";
import { addClientPolicy } from "@/lib/app-domain/client-policies";
import { createTask } from "@/lib/app-domain/tasks";
import { createImportantDate } from "@/lib/app-domain/important-dates";
import { duplicateFlag, findExisting, keepsSources, withLiveDuplicate, type ExistingItem } from "@/lib/app-domain/proposal-existing";
import { dateProposalKey, dateSchedule } from "@/lib/date-proposals";
import { entityByName, resolveLinks, withoutLinkNames } from "@/lib/app-domain/proposal-links";
import { applyContradiction, applyUpdate, currentItem, isUpdatable } from "@/lib/app-domain/proposal-updates";
import { isInternalClient } from "@/lib/app-domain/internal-client-id";
import { assertCanApproveForClient, canApproveForClient, notifyRuleApprovers, ruleApproversFor } from "@/lib/app-domain/rule-approvals";
import { datesInFile, isNamedTarget, listsOf, nameFieldOf, namesInFile } from "@/lib/app-domain/name-duplicates";
import { findDateMatches, findNameMatches, nameTokens } from "@/lib/name-match";

// Org brain, phase 2: proposals to the client file
// (claude/org-brain-spec-2026-10-12.md, 4, 5.1, 5.2; decisions 1 and 3).
//
// Claude reads a meeting or a document and proposes; a person approves on
// the screen. Three things are decided here, in code, and not left to the
// prompt (decision 3):
//
// 1. **Every proposal has a source** in the client's register. A batch
//    names its source once: an existing code, or a new one that is
//    registered on arrival (found again by its recording, so the same
//    meeting is never two sources).
// 2. **A secret never enters.** An item with a password, a key or a card
//    number in any of its fields is dropped before it is stored, and the
//    person who sent it gets a task to have the secret changed. What is
//    kept about it is the fact that it happened, not the secret.
// 3. **A topics-only source gives topics only.** A proposal that quotes it
//    is dropped.
//
// Approving does not write anything itself: it calls the same functions
// the screens call, as the person approving, so every rule of the file
// applies to an approved proposal exactly as to a typed item. There is no
// way to approve through MCP (spec 8).

export type ProposalItemInput = {
  target: ProposalTargetLike;
  action?: ProposalActionLike;
  /// For SUPERSEDE and CONTRADICT: the existing fact's id.
  targetId?: string | null;
  payload: Record<string, unknown>;
  /// The minute in the recording, "08:13".
  at?: string | null;
  /// Other sources in the register that say the same, "S3".
  alsoSources?: string[];
  reason?: string | null;
  quote?: string | null;
  /// How sure Claude is: HIGH, MEDIUM or LOW (spec 5.2).
  confidence?: string | null;
  /// CONFIRMED, UNCERTAIN or MISSING (31.10.2026): the same as
  /// `payload.knowledgeStatus`. Without either, it comes from `confidence`.
  status?: string | null;
};

export type BatchSourceInput =
  | { code: string }
  | {
      kind: SourceKind;
      title: string;
      occurredAt?: Date | null;
      participants?: string[];
      externalIds?: string[];
      restriction?: SourceRestriction;
      /// An Ankora document that writes down what the client said
      /// (21.10.2026): registered with the primary weight.
      weight?: SourceWeight;
    };

export type ProposeInput = {
  clientId: string;
  source: BatchSourceInput;
  note?: string | null;
  via?: "MCP" | "SCREEN";
  items: ProposalItemInput[];
};

export type ProposeResult = {
  batchId: string | null;
  /// Null when the source was new and nothing was kept: it is not
  /// registered (31.10.2026).
  sourceCode: string | null;
  proposed: number;
  dropped: { index: number; reason: string }[];
  secretTaskId: string | null;
  /// Items whose name may be one already in the file: send them again as
  /// SUPERSEDE with that targetId, or the reviewer adds them to it.
  possibleMatches: { index: number; target: string; name: string; existing: { id: string; name: string }[] }[];
};

const MAX_ITEMS = 60;

/// Rule R6 (spec 7.2, decision 5): a proposal marked sensitive (medical,
/// political, personal, or whatever the client's data-handling rules call
/// sensitive) is read and decided only by the client's approvers.
export function isSensitive(payload: unknown): boolean {
  return !!payload && typeof payload === "object" && (payload as Record<string, unknown>).sensitivity === "SENSITIVE";
}

export const SENSITIVE_PROPOSED = "knowledge.sensitive_proposed";

/// The batch's source as it is known before anything is written: one
/// already in the register (an existing code, or the source already
/// registered for the same recording), or one still to register.
///
/// 31.10.2026: a new source used to be registered before any item was
/// read, so a batch whose items were all dropped left an empty source
/// behind (RIMED S15 and S16). Now it is registered only when at least
/// one item is kept, together with the batch.
type PlannedSource =
  | { existing: true; id: string; code: string; title: string; weight: string; restriction: string }
  | { existing: false; code: string; title: string; weight: string; restriction: string; input: Exclude<BatchSourceInput, { code: string }> };

async function planSource(clientId: string, source: BatchSourceInput): Promise<PlannedSource> {
  if ("code" in source) {
    const found = await prisma.clientSource.findFirst({ where: { clientId, code: source.code.trim().toUpperCase(), deletedAt: null } });
    if (!found) throw new Error(`המקור ${source.code} לא קיים במרשם של הלקוח.`);
    return { existing: true, ...found };
  }
  const ids = (source.externalIds ?? []).map((i) => i.trim()).filter(Boolean);
  if (ids.length > 0) {
    const existing = await prisma.clientSource.findMany({ where: { clientId, deletedAt: null }, orderBy: { seq: "asc" } });
    const same = existing.find((s) => Array.isArray(s.externalRefs) && (s.externalRefs as { id?: string }[]).some((r) => r?.id && ids.includes(r.id)));
    if (same) return { existing: true, ...same };
  }
  if (!source.title.trim()) throw new Error("צריך שם למקור.");
  // The code it will most likely get, so a text that cites it is not
  // flagged as citing a code that is not in the register. The real code
  // is set once the source is registered.
  const last = await prisma.clientSource.findFirst({ where: { clientId }, orderBy: { seq: "desc" }, select: { seq: true } });
  return {
    existing: false,
    code: sourceCode((last?.seq ?? 0) + 1),
    title: source.title.trim(),
    weight: source.weight ?? defaultWeight(source.kind),
    restriction: source.restriction ?? "NONE",
    input: { ...source, externalIds: ids },
  };
}

async function registerPlanned(actor: User, clientId: string, planned: PlannedSource): Promise<{ id: string; code: string; created: boolean }> {
  if (planned.existing) return { id: planned.id, code: planned.code, created: false };
  const s = planned.input;
  const created = await addClientSource(actor, {
    clientId,
    kind: s.kind,
    title: s.title,
    occurredAt: s.occurredAt ?? null,
    participants: s.participants,
    externalIds: s.externalIds,
    restriction: s.restriction,
    weight: s.weight,
  });
  return { id: created.id, code: created.code, created: true };
}

/// What the reviewer should know before approving, found without asking
/// anybody: it is already in the file, or it will not be confirmed.
/// The client's source codes, for R17.
async function registerCodes(clientId: string): Promise<string[]> {
  return (await prisma.clientSource.findMany({ where: { clientId, deletedAt: null }, select: { code: true } })).map((s) => s.code);
}

async function flagsFor(clientId: string, item: ProposalItemInput & { payload: Record<string, unknown> }, sourceWeight: string, codes: string[]): Promise<ProposalFlag[]> {
  // What would stop it from entering the file first: the reviewer reads
  // these before anything else.
  const flags: ProposalFlag[] = proposalProblems(item.target, item.payload, codes);
  if (typeof item.payload.ownerName === "string" && item.payload.ownerName.trim() && !(await ownerByName(item.payload.ownerName))) {
    flags.push({ code: "OWNER", message: `אין איש צוות אחד בשם "${item.payload.ownerName.trim()}". הפריט ייכנס בלי בעלים, אלא אם מתקנים את השם.` });
  }
  if (item.target === "TASK" && typeof item.payload.assigneeName === "string" && item.payload.assigneeName.trim() && !(await ownerByName(item.payload.assigneeName))) {
    flags.push({ code: "OWNER", message: `אין איש צוות אחד בשם "${item.payload.assigneeName.trim()}". המשימה תיפתח על מי שמאשר, אלא אם מתקנים את השם.` });
  }
  const unlinked = (await resolveLinks(clientId, item.target, item.payload)).missing;
  if (unlinked.length) {
    flags.push({ code: "LINK", message: `לא נמצא בתיק: ${unlinked.join("; ")}. אם הוא ייכנס לתיק לפני האישור, הוא יקושר. אחרת הפריט ייכנס בלי הקישור הזה.` });
  }
  if (item.target !== "TASK" && item.target !== "DATE" && sourceWeight === "SECONDARY" && (item.payload.knowledgeStatus ?? "CONFIRMED") === "CONFIRMED" && (item.alsoSources ?? []).length === 0) {
    flags.push({ code: "R14", message: "המקור הוא מסמך של אנקורה, ולכן הפריט יישמר כלא ודאי." });
  }
  // The same match the card and the decision ask again later
  // (proposal-existing.ts): an item can enter the file after this.
  const exact = await findExisting(clientId, item.target, item.action ?? "CREATE", item.payload);
  if (exact) flags.push(duplicateFlag(item.target));
  // A name that may be an item already in the file, written otherwise:
  // "איילה" and "איילה מנצור" (lib/name-match.ts). Its own code, so the
  // exact check asked again on the card does not drop it.
  if (item.action === "CREATE" && isNamedTarget(item.target)) {
    const name = String(item.payload[nameFieldOf(item.target)] ?? "").trim();
    for (const m of name ? findNameMatches(name, await namesInFile(clientId, item.target)) : []) {
      if (m.id === exact?.id) continue;
      flags.push({
        code: "SIMILAR",
        match: { id: m.id, name: m.name },
        message: m.kind === "SAME" ? `"${m.name}" כבר בתיק. אפשר להוסיף את ההצעה אליו במקום פריט שני.` : `ייתכן שזה "${m.name}" הקיים. אפשר להוסיף את ההצעה אליו במקום פריט חדש.`,
      });
    }
  }
  // The same date under another title, on the same day: two rows for one
  // birthday (21.10.2026). Not merged: a date is opened and fixed by hand.
  if (item.action === "CREATE" && item.target === "DATE") {
    const title = String(item.payload.title ?? "").trim();
    for (const m of title ? findDateMatches({ name: title, key: dateProposalKey(item.payload) }, await datesInFile(clientId)) : []) {
      if (m.id === exact?.id) continue;
      flags.push({
        code: "SIMILAR",
        match: { id: m.id, name: m.name },
        message: `ייתכן שזה "${m.name}" הקיים: אותו יום, כמעט אותו שם. אם כן, דוחים את ההצעה ומשלימים את המועד הקיים.`,
      });
    }
  }
  if (isSensitive(item.payload)) {
    flags.push({ code: "R6", message: "מידע רגיש: רק מי שמאשר מידע רגיש אצל הלקוח רואה את הפריט ומחליט עליו." });
  }
  if (item.target === "NARRATIVE") {
    const latest = await prisma.clientNarrative.findFirst({ where: { clientId, kind: item.payload.kind as never }, orderBy: { version: "desc" }, select: { body: true } });
    if (latest && normalizeForMatch(latest.body) === normalizeForMatch(String(item.payload.body ?? ""))) flags.push({ code: "DUPLICATE", message: "זה כבר הטקסט שבתיק." });
    flags.push({ code: "NARRATIVE", message: latest ? "באישור, הטקסט הזה מחליף את הגרסה שבתיק (הקודמת נשמרת בהיסטוריה)." : "באישור, זו הגרסה הראשונה של הטקסט." });
  }
  if (item.target === "PROCESS") {
    flags.push({ code: "PROCESS", message: "באישור, התהליך נכנס כטיוטה. הנוהל רץ רק אחרי שמנהל מאשר אותו במסך התהליכים." });
  }
  if (item.target === "DATE") {
    if (typeof item.payload.responsibleName === "string" && item.payload.responsibleName.trim() && !(await ownerByName(item.payload.responsibleName))) {
      flags.push({ code: "OWNER", message: `אין איש צוות אחד בשם "${item.payload.responsibleName.trim()}". האחראי יהיה מי שמאשר, אלא אם מתקנים את השם.` });
    }
  }
  if (item.target === "TASK" && typeof item.payload.title === "string" && isQuestionTitle(item.payload.title)) {
    flags.push({ code: "TASK_TITLE", message: `הכותרת היא שאלה. באישור המשימה תיפתח כ"${actionTitle(item.payload.title)}". אפשר לנסח אחרת בעריכה.` });
  }
  if (item.target === "POLICY") {
    flags.push({ code: "POLICY", message: "באישור, הכלל נכנס לתיק כמוצע. מנהל מאשר אותו בנפרד כדי שייכנס לתוקף." });
  }
  // A new version of another kind is not one (see apply): say what
  // approving it does instead.
  if (item.action === "SUPERSEDE" && item.target === "FACT" && item.targetId) {
    const old = await prisma.clientFact.findUnique({ where: { id: item.targetId }, select: { kind: true, answeredAt: true } });
    if (old && old.kind !== item.payload.kind) {
      flags.push({
        code: "KIND",
        message:
          isQuestion(old.kind) && !old.answeredAt
            ? "הפריט בתיק הוא שאלה פתוחה. באישור, הטקסט הזה נרשם כתשובה שלה והשאלה נסגרת."
            : `הפריט בתיק הוא ${FACT_KIND_LABELS[old.kind]}, וההצעה היא ${FACT_KIND_LABELS[item.payload.kind as FactKindLike] ?? "סוג אחר"}. באישור, היא נכנסת כפריט חדש, והפריט שבתיק נשאר.`,
      });
    }
  }
  // A change to an item is about that item: "already in the file" is the point.
  if (item.action === "SUPERSEDE") return flags.filter((f) => f.code !== "DUPLICATE");
  return flags;
}

/// `options` is for a batch that waited for a person to pick its client
/// (lib/app-domain/batch-assignment.ts): who sent it, what was dropped
/// before it waited, and each item's index in what was sent.
export async function proposeKnowledge(
  actor: User,
  input: ProposeInput,
  options: { createdById?: string | null; dropped?: ProposeResult["dropped"]; indexes?: number[] } = {}
): Promise<ProposeResult> {
  assertCan(actor.role, "time_entry.create_self");
  await assertClientAccess(actor, input.clientId);
  if (input.items.length === 0) throw new Error("אין פריטים באצווה.");
  if (input.items.length > MAX_ITEMS) throw new Error(`עד ${MAX_ITEMS} פריטים באצווה. מחלקים לכמה אצוות.`);

  const source = await planSource(input.clientId, input.source);
  // Ankora's own file: its documents are the client's word (R14 does not
  // lower them there, client-sources.ts loadRegister), so no flag says so.
  const weight = (await isInternalClient(input.clientId)) ? "PRIMARY" : source.weight;
  const codes = [...(await registerCodes(input.clientId)), ...(source.existing ? [] : [source.code])];
  const dropped: ProposeResult["dropped"] = [...(options.dropped ?? [])];
  const accepted: { item: ProposalItemInput & { action: ProposalActionLike }; payload: Record<string, unknown>; flags: ProposalFlag[] }[] = [];
  const possibleMatches: ProposeResult["possibleMatches"] = [];

  for (const [i, raw] of input.items.entries()) {
    const index = options.indexes?.[i] ?? i;
    const path = `items[${index}]`;
    const item = { ...raw, action: raw.action ?? "CREATE" };
    // Secrets first, on everything the item carries, before anything else
    // looks at it: a refused item's text is never stored anywhere.
    const secrets = findSecrets([payloadText(item.payload), item.quote, item.reason].filter(Boolean).join("\n"));
    if (secrets.length > 0) {
      dropped.push({ index, reason: `נמצא ${secrets.map((s) => s.label).join(", ")}. הפריט לא נשמר.` });
      continue;
    }
    if (source.restriction === "TOPICS_ONLY" && item.quote?.trim()) {
      dropped.push({ index, reason: "המקור מוגבל לנושאים בלבד, ואסור לצטט ממנו." });
      continue;
    }
    const schema = PAYLOADS[item.target];
    if (!schema) {
      dropped.push({ index, reason: "סוג פריט לא מוכר." });
      continue;
    }
    // Spec 5.2: a reason and a status, or it is not read at all. The
    // status may be sent on the item or in the payload, and without one it
    // comes from the confidence (31.10.2026).
    const status = resolveKnowledgeStatus(item, path);
    if (!status.ok) {
      dropped.push({ index, reason: status.reason });
      continue;
    }
    item.payload = status.payload;
    const missing = missingRequired(item.target, item.payload, item.reason, path);
    if (missing) {
      dropped.push({ index, reason: missing });
      continue;
    }
    // A change to an item already in the file says only what changes.
    // So does a contradiction of one: what was said otherwise.
    const updating = (item.action === "SUPERSEDE" || item.action === "CONTRADICT") && isUpdatable(item.target);
    const parsed = updating ? (schema as unknown as { partial: () => typeof schema }).partial().safeParse(item.payload) : schema.safeParse(item.payload);
    if (!parsed.success) {
      dropped.push({ index, reason: `הפריט לא בנוי נכון: ${parsed.error.issues.map((i) => `${[`${path}.payload`, ...i.path].join(".")} ${i.message}`).join("; ")}` });
      continue;
    }
    if (updating) {
      if (!item.targetId || !(await currentItem(input.clientId, item.target, item.targetId))) {
        dropped.push({ index, reason: "הפריט שההצעה מעדכנת לא נמצא בתיק. targetId הוא המזהה שמופיע בתיק (id: ...)." });
        continue;
      }
    } else if (item.action !== "CREATE") {
      if (item.target !== "FACT" || !item.targetId) {
        dropped.push({ index, reason: "עדכון (SUPERSEDE) וסתירה (CONTRADICT) הם של פריט קיים: עובדה, איש קשר, ארגון, מערכת, סוג פנייה, כלל, ישות או תהליך, עם המזהה שלו." });
        continue;
      }
      const fact = await prisma.clientFact.findFirst({ where: { id: item.targetId, clientId: input.clientId, deletedAt: null, knowledgeStatus: { not: "SUPERSEDED" } } });
      if (!fact) {
        dropped.push({ index, reason: "הפריט שההצעה מתייחסת אליו לא נמצא בתיק, או שכבר הוחלף." });
        continue;
      }
    }
    // The batch's source, at the minute, and any other register codes
    // that say the same.
    // A new source's code is set when it is registered, below.
    const refs: SourceRef[] = [item.at ? { code: source.code, at: item.at } : { code: source.code }];
    for (const c of item.alsoSources ?? []) if (/^S\d+$/i.test(c.trim())) refs.push({ code: c.trim().toUpperCase() });
    const payload: Record<string, unknown> = { ...(parsed.data as Record<string, unknown>), sources: refs };
    // A free text replaces the whole text: it is written against the
    // version current now, so approving it later never overwrites a
    // change made in between.
    if (item.target === "NARRATIVE") {
      const latest = await prisma.clientNarrative.findFirst({ where: { clientId: input.clientId, kind: payload.kind as never }, orderBy: { version: "desc" }, select: { version: true } });
      payload.baseVersion = latest?.version ?? 0;
    }
    const flags = await flagsFor(input.clientId, { ...item, payload }, weight, codes);
    const existing = flags.flatMap((f) => (f.match ? [f.match] : []));
    if (existing.length && isNamedTarget(item.target)) possibleMatches.push({ index, target: item.target, name: String(payload[nameFieldOf(item.target)] ?? ""), existing });
    else if (existing.length && item.target === "DATE") possibleMatches.push({ index, target: item.target, name: String(payload.title ?? ""), existing });
    accepted.push({ item, payload, flags });
  }

  let secretTaskId: string | null = null;
  // A secret dropped before the batch waited for its client already has its task.
  if (dropped.slice(options.dropped?.length ?? 0).some((d) => d.reason.startsWith("נמצא"))) {
    // The secret was said; it has to be changed. The task says where, never what.
    const task = await createTask(actor, {
      clientId: input.clientId,
      title: (source.existing ? `להחליף סוד שנאמר ב-${source.code}: ${source.title}` : `להחליף סוד שנאמר ב: ${source.title}`).slice(0, 200),
      description: "בהצעות מהמקור הזה נמצאו סיסמה, מפתח או מספר כרטיס. הם לא נשמרו בתיק. מי שנחשף להם צריך להחליף אותם, ולשמור את החדשים בכספת.",
      assignedToId: actor.id,
      priority: "HIGH",
    });
    secretTaskId = task.id;
  }

  // Nothing kept: a new source is not registered (31.10.2026).
  if (accepted.length === 0) {
    return { batchId: null, sourceCode: source.existing ? source.code : null, proposed: 0, dropped, secretTaskId, possibleMatches };
  }

  // The source and the batch go in together: a new source is registered
  // only now, and removed again if the batch cannot be written, so the
  // register never keeps a source with nothing from it.
  const registered = await registerPlanned(actor, input.clientId, source);
  if (registered.code !== source.code) {
    for (const a of accepted) {
      a.payload.sources = (a.payload.sources as SourceRef[]).map((r) => (r.code === source.code ? { ...r, code: registered.code } : r));
    }
  }
  let batch;
  try {
    // One write: the batch and its proposals together.
    batch = await prisma.knowledgeBatch.create({
      data: {
        clientId: input.clientId,
        sourceId: registered.id,
        via: input.via ?? "MCP",
        note: input.note?.trim() || null,
        // Only the index and the reason: never the dropped text.
        dropped: dropped as Prisma.InputJsonValue,
        createdById: options.createdById === undefined ? actor.id : options.createdById,
        proposals: {
          create: accepted.map(({ item, payload, flags }) => ({
            clientId: input.clientId,
            target: item.target,
            action: item.action,
            targetId: item.targetId ?? null,
            payload: payload as Prisma.InputJsonValue,
            reason: item.reason?.trim() || null,
            quote: item.quote?.trim() || null,
            confidence: CONFIDENCE_LEVELS.includes(item.confidence as ConfidenceLike) ? item.confidence : null,
            flags: flags as Prisma.InputJsonValue,
          })),
        },
      },
    });
  } catch (err) {
    if (registered.created) await prisma.clientSource.delete({ where: { id: registered.id } }).catch(() => {});
    throw err;
  }
  const sensitive = accepted.filter(({ payload }) => isSensitive(payload)).length;
  if (sensitive > 0) {
    const client = await prisma.client.findUniqueOrThrow({ where: { id: input.clientId }, select: { name: true } });
    await notifyRuleApprovers(input.clientId, actor.id, {
      type: SENSITIVE_PROPOSED,
      title: `${client.name}: מידע רגיש ממתין לאישור שלך`,
      body: `${sensitive === 1 ? "פריט רגיש אחד" : `${sensitive} פריטים רגישים`} מ-${registered.code} ${source.title}. רק מי שמאשר מידע רגיש אצל הלקוח רואה אותם.`.slice(0, 500),
      entityType: "Knowledge",
    });
  }
  await recordAudit({
    actorId: actor.id,
    action: "knowledge_batch.propose",
    entityType: "KnowledgeBatch",
    entityId: batch.id,
    clientId: input.clientId,
    after: { sourceCode: registered.code, proposed: accepted.length, dropped: dropped.length },
  });
  return { batchId: batch.id, sourceCode: registered.code, proposed: accepted.length, dropped, secretTaskId, possibleMatches };
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

/// Open batches, newest first, for the clients this person can reach.
export async function listOpenBatches(actor: User, filter: { clientId?: string } = {}) {
  assertCan(actor.role, "time_entry.create_self");
  const accessible = (await listAccessibleClients(actor)).map((c) => c.id);
  const clientIds = filter.clientId ? accessible.filter((id) => id === filter.clientId) : accessible;
  if (clientIds.length === 0) return [];
  const batches = await prisma.knowledgeBatch.findMany({
    where: { clientId: { in: clientIds }, closedAt: null, awaitingAssignment: false },
    orderBy: { createdAt: "desc" },
    include: {
      client: { select: { id: true, name: true, accountManagerId: true } },
      proposals: { orderBy: { createdAt: "asc" } },
    },
  });
  const sourceIds = batches.map((b) => b.sourceId).filter((id): id is string => !!id);
  const sources = await prisma.clientSource.findMany({ where: { id: { in: sourceIds } } });
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const userIds = [...new Set(batches.map((b) => b.createdById).filter((id): id is string => !!id))];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  // What a "new version" or a "contradiction" is about, so the reviewer
  // sees both side by side.
  const targetIds = batches.flatMap((b) => b.proposals.map((p) => p.targetId)).filter((id): id is string => !!id);
  const targets = await prisma.clientFact.findMany({
    where: { id: { in: targetIds }, clientId: { in: clientIds } },
    select: { id: true, body: true, knowledgeStatus: true, sources: true },
  });
  const targetById = new Map<string, { id: string; body: string }>(targets.map((t) => [t.id, t]));
  // A change to another kind of item: the item as it is now.
  for (const b of batches) {
    for (const pr of b.proposals) {
      if (pr.targetId && pr.target !== "FACT" && !targetById.has(pr.targetId)) {
        const now = await currentItem(b.clientId, pr.target, pr.targetId);
        if (now) targetById.set(pr.targetId, now);
      }
    }
  }
  // R6: a sensitive proposal is shown to the client's approvers only.
  // Everyone else sees that one is waiting, and for whom, not what it says.
  const approverOf = new Map<string, boolean>();
  const approverNames = new Map<string, string>();
  for (const clientId of new Set(batches.filter((b) => b.proposals.some((p) => isSensitive(p.payload))).map((b) => b.clientId))) {
    approverOf.set(clientId, await canApproveForClient(actor, clientId));
    approverNames.set(clientId, (await ruleApproversFor(clientId)).map((u) => u.name).join(" או "));
  }
  // "Already in the file", as it stands now (proposal-existing.ts): an
  // item that entered after the proposal arrived is found too, and one
  // that left is no longer said to be there.
  const alreadyIn = new Map<string, ExistingItem | null>();
  for (const b of batches) {
    for (const pr of b.proposals) {
      if (pr.state === "PENDING" && pr.action === "CREATE") alreadyIn.set(pr.id, await findExisting(b.clientId, pr.target, pr.action, pr.payload as Record<string, unknown>));
    }
  }
  // A batch of Ankora's own file that arrived before 1.11.2026 still
  // carries the R14 flag: approving it no longer lowers anything there.
  const internal = new Set<string>();
  for (const clientId of new Set(batches.map((b) => b.clientId))) if (await isInternalClient(clientId)) internal.add(clientId);
  const withoutR14 = (clientId: string, flags: Prisma.JsonValue) =>
    internal.has(clientId) && Array.isArray(flags) ? ((flags as ProposalFlag[]).filter((f) => f.code !== "R14") as Prisma.JsonValue) : flags;
  const liveFlags = (pr: { id: string; clientId: string; target: string; flags: Prisma.JsonValue }) => {
    const flags = withoutR14(pr.clientId, pr.flags);
    return alreadyIn.has(pr.id) ? (withLiveDuplicate((Array.isArray(flags) ? flags : []) as ProposalFlag[], pr.target, alreadyIn.get(pr.id) ?? null) as Prisma.JsonValue) : flags;
  };
  return batches.map((b) => ({
    ...b,
    source: b.sourceId ? sourceById.get(b.sourceId) ?? null : null,
    createdByName: b.createdById ? nameOf.get(b.createdById) ?? null : null,
    proposals: b.proposals.map((p) => {
      const hidden = isSensitive(p.payload) && !approverOf.get(b.clientId);
      return hidden
        ? {
            ...p,
            payload: { sensitivity: "SENSITIVE", kind: (p.payload as Record<string, unknown>).kind ?? null } as Prisma.JsonValue,
            reason: null,
            quote: null,
            existing: null,
            alreadyIn: null as (ExistingItem & { addsSources: boolean }) | null,
            hiddenFor: approverNames.get(b.clientId) || "מי שמאשר מידע רגיש",
          }
        : {
            ...p,
            flags: liveFlags(p),
            existing: p.targetId ? targetById.get(p.targetId) ?? null : null,
            alreadyIn: alreadyIn.get(p.id) ? { ...alreadyIn.get(p.id)!, addsSources: keepsSources(p.target) && readSourceRefs((p.payload as Record<string, unknown>).sources).length > 0 } : null,
            hiddenFor: null as string | null,
          };
    }),
  }));
}

export async function countPendingProposals(actor: User, clientId?: string): Promise<number> {
  const accessible = (await listAccessibleClients(actor)).map((c) => c.id);
  const proposals = await prisma.knowledgeProposal.count({
    where: { state: "PENDING", clientId: clientId ? { in: accessible.filter((id) => id === clientId) } : { in: accessible } },
  });
  if (clientId) return proposals;
  // A meeting waiting for a person to say whose it is counts as one, for
  // whoever may see it: someone with every candidate client.
  const waiting = await prisma.knowledgeBatch.findMany({ where: { awaitingAssignment: true }, select: { candidateClientIds: true } });
  const mine = new Set(accessible);
  return proposals + waiting.filter((b) => b.candidateClientIds.every((id) => mine.has(id))).length;
}

async function findPending(actor: User, id: string) {
  const proposal = await prisma.knowledgeProposal.findUnique({ where: { id } });
  if (!proposal) throw new Error("ההצעה לא נמצאה.");
  await assertClientAccess(actor, proposal.clientId);
  if (proposal.state !== "PENDING") throw new Error("כבר הוחלט על ההצעה הזו.");
  return proposal;
}

async function closeIfDone(batchId: string) {
  const pending = await prisma.knowledgeProposal.count({ where: { batchId, state: "PENDING" } });
  if (pending === 0) await prisma.knowledgeBatch.update({ where: { id: batchId }, data: { closedAt: new Date() } });
}

/// Writes the proposal into the file, as the person approving it, through
/// the file's own functions. `edits` are the fields the person changed.
function withoutOwnerName<T extends { ownerName?: unknown }>(v: T): Omit<T, "ownerName"> {
  const { ownerName: _o, ...rest } = v;
  return rest;
}

/// Spec 3.1: the owner a proposal names, as a person at Ankora. A name
/// that is nobody, or more than one person, is no owner: the item enters
/// without one, and its flag said so when it arrived.
export async function ownerByName(name: unknown): Promise<string | null> {
  if (typeof name !== "string" || !name.trim()) return null;
  const found = await prisma.user.findMany({
    where: { deletedAt: null, status: "ACTIVE", role: { not: "CLIENT_USER" }, name: { equals: name.trim(), mode: "insensitive" } },
    select: { id: true },
    take: 2,
  });
  return found.length === 1 ? found[0].id : null;
}

/// A rule's parameters as Claude sends them, with entities by name
/// (entityName, entityNames) turned into the ids the checks read. An
/// entity that is not in the file is left out: the rule is then checked
/// for every entity, which is the careful reading.
async function paramsWithEntities(clientId: string, value: Record<string, unknown> | null | undefined) {
  if (!value) return null;
  const { entityName, entityNames, ...rest } = value as Record<string, unknown> & { entityName?: unknown; entityNames?: unknown };
  const out: Record<string, unknown> = { ...rest };
  if (typeof entityName === "string" && entityName.trim()) {
    const id = await entityByName(clientId, entityName.trim());
    if (id) out.entityId = id;
  }
  if (Array.isArray(entityNames)) {
    const ids: string[] = [];
    for (const n of entityNames) {
      if (typeof n !== "string" || !n.trim()) continue;
      const id = await entityByName(clientId, n.trim());
      if (id) ids.push(id);
    }
    if (ids.length) out.entityIds = ids;
  }
  return out;
}

async function apply(
  actor: User,
  p: { clientId: string; target: string; action: string; targetId: string | null; batchId: string; reason: string | null; quote: string | null },
  payload: Record<string, unknown>
) {
  const date = (v: unknown) => (typeof v === "string" && v ? new Date(`${v}T00:00:00Z`) : null);
  const sources = readSourceRefs(payload.sources);
  const ownerId = await ownerByName(payload.ownerName);
  // A change names its owner or keeps the one the item has. A new item
  // nobody named an owner for is kept by the client's account manager
  // (spec 3.1): an item with no owner is an item nobody keeps right.
  const manager = ownerId || p.action !== "CREATE" ? null : (await prisma.client.findUnique({ where: { id: p.clientId }, select: { accountManagerId: true } }))?.accountManagerId ?? null;
  const owner = ownerId ? { ownerId } : manager ? { ownerId: manager } : {};
  // Contacts, systems, entities and processes it names, found in the file
  // now: something approved earlier in the same batch is found too.
  const links = await resolveLinks(p.clientId, p.target, payload);
  const linked = links.fields;
  if (p.action === "CONTRADICT" && p.targetId && isUpdatable(p.target)) {
    return applyContradiction(actor, { clientId: p.clientId, target: p.target, targetId: p.targetId }, proposalHeadline(p.target as ProposalTargetLike, payload), sources);
  }
  if (p.action === "SUPERSEDE" && p.targetId && isUpdatable(p.target)) {
    const schema = PAYLOADS[p.target] as unknown as { partial: () => { parse: (v: unknown) => Record<string, unknown> } };
    const { steps, highlights, outputs, ownerName: _o, params, interimParams, effectiveFrom, reviewBy, ...rest } = withoutLinkNames(schema.partial().parse(payload)) as Record<string, unknown>;
    const fields: Record<string, unknown> = { ...rest, ...linked, ...owner };
    if (p.target === "POLICY") {
      if (params !== undefined) fields.params = await paramsWithEntities(p.clientId, params as Record<string, unknown> | null);
      if (interimParams !== undefined) fields.interimParams = await paramsWithEntities(p.clientId, interimParams as Record<string, unknown> | null);
      if (effectiveFrom !== undefined) fields.effectiveFrom = date(effectiveFrom);
      if (reviewBy !== undefined) fields.reviewBy = date(reviewBy);
    }
    const procedure =
      p.target === "PROCESS" && Array.isArray(steps) && steps.length
        ? { steps: (steps as Record<string, unknown>[]).map(({ systemNames: _s, ...st }, i) => ({ ...st, systemIds: links.stepSystemIds[i] ?? [] })), highlights: highlights as string | null, outputs: outputs as string | null }
        : null;
    return applyUpdate(actor, { clientId: p.clientId, target: p.target, targetId: p.targetId }, fields, sources, procedure);
  }
  if (p.target === "FACT") {
    const f = withoutLinkNames(PAYLOADS.FACT.parse(payload));
    const { ownerName: _o, ...fact } = f;
    const input = { ...fact, ...linked, ...owner, sources, validUntil: date(f.validUntil), decidedAt: date(f.decidedAt) };
    if (p.action === "SUPERSEDE") {
      // A new version is of the same kind (client-facts.ts). Another kind
      // is not: an open question meets its answer, anything else enters
      // as an item of its own (28.10.2026, NUX: a note that answered the
      // question on US vacations failed on approve).
      const old = await prisma.clientFact.findUnique({ where: { id: p.targetId! }, select: { kind: true, answeredAt: true } });
      if (old && old.kind !== f.kind) {
        if (isQuestion(old.kind) && !old.answeredAt) return (await answerClientQuestion(actor, p.targetId!, { answer: f.body, sources })).id;
        return (await addClientFact(actor, { ...input, clientId: p.clientId })).id;
      }
      return (await supersedeClientFact(actor, p.targetId!, input)).id;
    }
    if (p.action === "CONTRADICT") return (await recordContradiction(actor, p.targetId!, { value: f.body, sources })).id;
    return (await addClientFact(actor, { ...input, clientId: p.clientId })).id;
  }
  if (p.target === "CONTACT") return (await addClientContact(actor, { ...withoutLinkNames(withoutOwnerName(PAYLOADS.CONTACT.parse(payload))), ...linked, ...owner, sources, clientId: p.clientId })).id;
  if (p.target === "ORGANIZATION") return (await addClientOrganization(actor, { ...withoutOwnerName(PAYLOADS.ORGANIZATION.parse(payload)), ...owner, sources, clientId: p.clientId })).id;
  if (p.target === "REQUEST_TYPE") return (await addRequestType(actor, { ...withoutLinkNames(withoutOwnerName(PAYLOADS.REQUEST_TYPE.parse(payload))), ...linked, ...owner, sources, clientId: p.clientId })).id;
  // A rule enters the file as "proposed": approving the proposal records
  // what the client said; making it binding is a manager's separate step.
  if (p.target === "POLICY") {
    const r = withoutOwnerName(PAYLOADS.POLICY.parse(payload));
    const params = await paramsWithEntities(p.clientId, r.params);
    const interimParams = await paramsWithEntities(p.clientId, r.interimParams);
    return (await addClientPolicy(actor, { ...r, params, interimParams, effectiveFrom: date(r.effectiveFrom), reviewBy: date(r.reviewBy), ...owner, sources, clientId: p.clientId })).id;
  }
  if (p.target === "SYSTEM") return (await addSystemAccess(actor, { ...withoutLinkNames(withoutOwnerName(PAYLOADS.SYSTEM.parse(payload))), ...linked, ...owner, sources, clientId: p.clientId })).id;
  if (p.target === "ENTITY") {
    const { parentName, ownerName: _o, ...e } = PAYLOADS.ENTITY.parse(payload);
    let parentId: string | null = null;
    if (parentName?.trim()) {
      const parent = await prisma.clientEntity.findFirst({ where: { clientId: p.clientId, deletedAt: null, name: { equals: parentName.trim(), mode: "insensitive" } }, select: { id: true } });
      if (!parent) throw new Error(`ישות האם "${parentName}" לא נמצאת בתיק. מוסיפים אותה קודם, או מוחקים את השם בעריכה.`);
      parentId = parent.id;
    }
    return (await addClientEntity(actor, { ...e, ...owner, parentId, sources, clientId: p.clientId })).id;
  }
  if (p.target === "NARRATIVE") {
    const n = PAYLOADS.NARRATIVE.parse(payload);
    try {
      const row = await saveNarrative(actor, { clientId: p.clientId, kind: n.kind, body: n.body, baseVersion: n.baseVersion ?? 0 });
      if (!row) throw new Error("זה כבר הטקסט שבתיק. דוחים את ההצעה.");
      return row.id;
    } catch (err) {
      if (err instanceof NarrativeConflictError) throw new Error("מישהו שינה את הטקסט מאז שההצעה הגיעה. דוחים אותה, ומעדכנים את הטקסט במסך הלקוח.");
      throw err;
    }
  }
  // A process enters as a draft, with its procedure as a draft version:
  // approving the proposal records what was described; a manager approves
  // the procedure separately, after the checks (spec 3.9, decision 1).
  if (p.target === "PROCESS") {
    const { steps, highlights, outputs, ownerName: _o, ...proc } = withoutLinkNames(PAYLOADS.PROCESS.parse(payload));
    const process = await addProcess(actor, { ...proc, ...linked, ...owner, sources, clientId: p.clientId });
    if (steps?.length) {
      const withSystems = steps.map(({ systemNames: _s, ...st }, i) => ({ ...st, systemIds: links.stepSystemIds[i] ?? [] }));
      await saveProcessVersion(actor, process.id, { steps: withSystems, highlights, outputs, baseVersion: 0 });
    }
    return process.id;
  }
  // A client's own date: into the dates, with its reminders, linked to the
  // process it starts. Who is responsible, by name, or whoever approves.
  if (p.target === "DATE") {
    const d = PAYLOADS.DATE.parse(payload);
    const responsible = (await ownerByName(d.responsibleName)) ?? actor.id;
    const created = await createImportantDate(actor, {
      clientId: p.clientId,
      title: d.title,
      type: "CLIENT",
      category: d.category ?? "BUSINESS_FINANCE",
      ...dateSchedule(d),
      responsibleUserId: responsible,
      sensitivity: d.sensitivity ?? undefined,
      notes: d.notes ?? null,
      conditionText: d.conditionText ?? null,
      expectsReceipt: d.expectsReceipt ?? false,
      expectedFrom: d.expectedFrom ?? null,
      createAutoTask: d.taskDaysBefore != null,
      autoTaskLeadDays: d.taskDaysBefore ?? null,
      useDefaultReminders: true,
    });
    if (linked.processId) {
      const now = await prisma.importantDate.findMany({ where: { processId: linked.processId as string, deletedAt: null }, select: { id: true } });
      await linkProcessDates(actor, linked.processId as string, [...now.map((x) => x.id), created.id]);
    }
    if (d.clientVisible) await prisma.importantDate.update({ where: { id: created.id }, data: { clientVisible: true } });
    return created.id;
  }
  if (p.target === "DOMAIN") return (await addClientDomain(actor, { ...PAYLOADS.DOMAIN.parse(payload), clientId: p.clientId })).id;
  // Something to do: a task on the client, with where it came from, so it
  // can be done without going back to the meeting.
  if (p.target === "TASK") {
    const parsed = PAYLOADS.TASK.safeParse(payload);
    if (!parsed.success) throw new Error(`המשימה לא בנויה נכון: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
    const t = parsed.data;
    const draft = await draftFor({ ...p, payload: payload as Prisma.JsonValue });
    const assignee = await ownerByName(t.assigneeName);
    const task = await createTask(actor, {
      clientId: p.clientId,
      title: draft.title,
      description: draft.description,
      assignedToId: assignee ?? actor.id,
      // 21.10.2026: by when, and under what, even when nobody said.
      dueDate: date(t.dueDate) ?? defaultDueDate(),
      categoryId: await autoCategory(actor, p.clientId, draft.title),
      ...(t.priority ? { priority: t.priority } : {}),
    });
    return task.id;
  }
  throw new Error("סוג פריט לא מוכר.");
}

export async function approveProposal(actor: User, id: string, edits: Record<string, unknown> = {}, options: { bulk?: boolean } = {}) {
  assertCan(actor.role, "time_entry.create_self");
  const proposal = await findPending(actor, id);
  if (isSensitive(proposal.payload)) await assertCanApproveForClient(actor, proposal.clientId);
  const original = proposal.payload as Record<string, unknown>;
  // "Not visible to the client" is what an item without the field means:
  // leaving it as it was is no edit.
  const was = (k: string) => original[k] ?? (k === "clientVisible" ? false : null);
  const changed = Object.entries(edits).filter(([k, v]) => k !== "sources" && JSON.stringify(was(k)) !== JSON.stringify(v ?? null));
  const payload = { ...original, ...Object.fromEntries(changed) };
  // An edit is checked for secrets like the original was.
  if (changed.length > 0 && findSecrets(payloadText(Object.fromEntries(changed))).length > 0) {
    throw new Error("בעריכה יש סיסמה, מפתח או מספר כרטיס. סודות נשמרים בכספת, לא בתיק.");
  }
  // The same checks the card showed, on the text as approved: an edit can
  // fix a problem, and one cannot sneak one in.
  const blocking = proposalProblems(proposal.target, payload, await registerCodes(proposal.clientId)).filter((f) => f.block);
  if (blocking.length) throw new Error(blocking[0].message);
  // Where the file refuses a second copy, say what to do instead of only
  // that it is there (20.10.2026).
  if (["ORGANIZATION", "CONTACT", "SYSTEM"].includes(proposal.target)) {
    const existing = await findExisting(proposal.clientId, proposal.target, proposal.action, payload);
    if (existing) throw new Error(`${existing.body}: כבר בתיק. "כבר בתיק: הוספת המקור" מוסיף את המקור לפריט שבתיק.`);
  }
  const resultId = await apply(actor, proposal, payload);
  const updated = await prisma.knowledgeProposal.update({
    where: { id },
    data: {
      state: "APPROVED",
      decidedById: actor.id,
      decidedAt: new Date(),
      edited: changed.length > 0,
      resultId,
      payload: payload as Prisma.InputJsonValue,
    },
  });
  await closeIfDone(proposal.batchId);
  await recordAudit({
    actorId: actor.id,
    action: "knowledge_proposal.approve",
    entityType: "KnowledgeProposal",
    entityId: id,
    clientId: proposal.clientId,
    after: { resultId, edited: changed.length > 0, headline: proposalHeadline(proposal.target, payload), ...(options.bulk ? { bulk: true } : {}) },
  });
  return updated;
}

/// "כבר בתיק" (20.10.2026): what the proposal says is already in the
/// file. Nothing new is created. The sources it brings are added to the
/// item there, as a change proposal adds them, and the proposal closes
/// as approved, pointing at that item. A date or a domain keeps no
/// sources, so for them it only closes.
export async function attachProposalToExisting(actor: User, id: string) {
  assertCan(actor.role, "time_entry.create_self");
  const proposal = await findPending(actor, id);
  if (isSensitive(proposal.payload)) await assertCanApproveForClient(actor, proposal.clientId);
  const payload = proposal.payload as Record<string, unknown>;
  const existing = await findExisting(proposal.clientId, proposal.target, proposal.action, payload);
  if (!existing) throw new Error("הפריט כבר לא בתיק. מאשרים את ההצעה כרגיל.");
  const sources = readSourceRefs(payload.sources);
  if (sources.length && keepsSources(proposal.target)) {
    if (proposal.target === "FACT") await addClientFactSources(actor, existing.id, sources);
    else if (isUpdatable(proposal.target)) await applyUpdate(actor, { clientId: proposal.clientId, target: proposal.target, targetId: existing.id }, {}, sources);
  }
  const updated = await prisma.knowledgeProposal.update({
    where: { id },
    data: { state: "APPROVED", decidedById: actor.id, decidedAt: new Date(), edited: false, attached: true, resultId: existing.id },
  });
  await closeIfDone(proposal.batchId);
  await recordAudit({
    actorId: actor.id,
    action: "knowledge_proposal.attach",
    entityType: "KnowledgeProposal",
    entityId: id,
    clientId: proposal.clientId,
    after: { resultId: existing.id, existing: existing.body, sources: sources.map((r) => r.code), headline: proposalHeadline(proposal.target, payload) },
  });
  return updated;
}

/// The proposal is an item already in the file under another spelling
/// ("איילה" and "איילה מנצור"): approve it as a change to that item,
/// not as a second one. The longer name stays, the emails, phones and
/// domains are added to the item's, and the rest is an ordinary update,
/// with every check the update makes.
export async function mergeProposal(actor: User, id: string, targetId: string) {
  assertCan(actor.role, "time_entry.create_self");
  const proposal = await findPending(actor, id);
  if (proposal.action !== "CREATE" || !isNamedTarget(proposal.target)) throw new Error("רק הצעה לפריט חדש עם שם אפשר להוסיף לפריט קיים.");
  const target = proposal.target;
  const now = await currentItem(proposal.clientId, target, targetId);
  if (!now) throw new Error("הפריט הקיים כבר לא בתיק.");
  const existing = (await namesInFile(proposal.clientId, target)).find((n) => n.id === targetId);
  const payload = { ...(proposal.payload as Record<string, unknown>) };
  const field = nameFieldOf(target);
  if (existing && nameTokens(String(payload[field] ?? "")).length <= nameTokens(existing.name).length) delete payload[field];
  for (const [k, had] of Object.entries(await listsOf(target, targetId))) {
    if (Array.isArray(payload[k])) payload[k] = [...new Set([...had, ...(payload[k] as string[])])];
  }
  const flags = (Array.isArray(proposal.flags) ? (proposal.flags as ProposalFlag[]) : []).filter((f) => f.code !== "DUPLICATE" && f.code !== "SIMILAR");
  await prisma.knowledgeProposal.update({
    where: { id },
    data: { action: "SUPERSEDE", targetId, payload: payload as Prisma.InputJsonValue, flags: flags as Prisma.InputJsonValue },
  });
  try {
    const approved = await approveProposal(actor, id);
    await recordAudit({
      actorId: actor.id,
      action: "knowledge_proposal.merge",
      entityType: "KnowledgeProposal",
      entityId: id,
      clientId: proposal.clientId,
      after: { targetId, into: existing?.name ?? null },
    });
    return approved;
  } catch (err) {
    // Not approved: the proposal goes back to what it was.
    await prisma.knowledgeProposal.update({
      where: { id },
      data: { action: "CREATE", targetId: null, payload: proposal.payload as Prisma.InputJsonValue, flags: (proposal.flags ?? []) as Prisma.InputJsonValue },
    });
    throw err;
  }
}

export async function rejectProposal(actor: User, id: string, reason: string, options: { bulk?: boolean } = {}) {
  assertCan(actor.role, "time_entry.create_self");
  const proposal = await findPending(actor, id);
  if (isSensitive(proposal.payload)) await assertCanApproveForClient(actor, proposal.clientId);
  const why = reason.trim();
  // One line, so the next prompt can learn from it (spec 5.4).
  if (!why) throw new Error("צריך לכתוב בשורה אחת למה ההצעה נדחתה.");
  const updated = await prisma.knowledgeProposal.update({
    where: { id },
    data: { state: "REJECTED", decidedById: actor.id, decidedAt: new Date(), rejectReason: why.slice(0, 500) },
  });
  await closeIfDone(proposal.batchId);
  await recordAudit({
    actorId: actor.id,
    action: "knowledge_proposal.reject",
    entityType: "KnowledgeProposal",
    entityId: id,
    clientId: proposal.clientId,
    after: { reason: why, ...(options.bulk ? { bulk: true } : {}) },
  });
  return updated;
}

/// A task from a proposal is due in three business days when nobody said
/// by when (21.10.2026), so it does not sit in the list without a date.
function defaultDueDate(): Date {
  return new Date(`${defaultTaskDue(localDateKey(new Date(), "Asia/Jerusalem"))}T00:00:00Z`);
}

/// The category the task's words point to (lib/mcp/category-pick.ts), the
/// same pick create_task makes. Dynamic, as in employee-lifecycle.ts: the
/// lookup module imports back into the app domain.
async function autoCategory(actor: User, clientId: string, text: string): Promise<string | null> {
  try {
    const { autoPickCategory } = await import("@/lib/mcp/lookup");
    return (await autoPickCategory(actor, clientId, text))?.id ?? null;
  } catch {
    return null;
  }
}

async function draftFor(proposal: { batchId: string; target: string; payload: Prisma.JsonValue; reason: string | null; quote: string | null }) {
  const batch = await prisma.knowledgeBatch.findUnique({ where: { id: proposal.batchId }, select: { sourceId: true } });
  const source = batch?.sourceId ? await prisma.clientSource.findUnique({ where: { id: batch.sourceId }, select: { code: true, title: true, externalRefs: true } }) : null;
  const payload = (proposal.payload ?? {}) as Record<string, unknown>;
  const refs = source && Array.isArray(source.externalRefs) ? (source.externalRefs as { system?: string; id?: string }[]) : [];
  const fireflies = refs.find((r) => r?.system === "FIREFLIES")?.id ?? null;
  const at = readSourceRefs(payload.sources)[0]?.at ?? null;
  return taskFromProposal({
    target: proposal.target as ProposalTargetLike,
    payload,
    reason: proposal.reason,
    quote: proposal.quote,
    source: source ? { code: source.code, title: source.title } : null,
    link: fireflies ? firefliesLink(fireflies, at) : null,
  });
}

/// A proposal that is something to do, not something to know: it opens a
/// task on the client and is closed as "became a task", so it neither
/// enters the file nor counts as a wrong extraction. The person may change
/// the title and description; empty ones take the draft.
export async function proposalToTask(
  actor: User,
  id: string,
  input: { title?: string | null; description?: string | null; assignedToId?: string | null; dueDate?: Date | null; priority?: TaskPriority | null; categoryId?: string | null } = {}
) {
  assertCan(actor.role, "time_entry.create_self");
  const proposal = await findPending(actor, id);
  const blocker = taskBlocker({ target: proposal.target as ProposalTargetLike, payload: (proposal.payload ?? {}) as Record<string, unknown> });
  if (blocker) throw new Error(blocker);
  const draft = await draftFor(proposal);
  const title = actionTitle(input.title?.trim() || draft.title).slice(0, TASK_TITLE_MAX);
  const problem = taskTitleProblem(title, { target: proposal.target as ProposalTargetLike, headline: draft.said });
  if (problem) throw new Error(problem);
  const description = input.description?.trim() || draft.description;
  // The same check as on the way in: what the person typed is not saved
  // if it holds a password, a key or a card number.
  if (findSecrets(`${title}\n${description}`).length > 0) throw new Error("בטקסט יש סיסמה, מפתח או מספר כרטיס. צריך להסיר אותם לפני שפותחים משימה.");
  const task = await createTask(actor, {
    clientId: proposal.clientId,
    title,
    description,
    assignedToId: input.assignedToId || actor.id,
    dueDate: input.dueDate ?? defaultDueDate(),
    categoryId: input.categoryId || (await autoCategory(actor, proposal.clientId, title)),
    ...(input.priority ? { priority: input.priority } : {}),
  });
  const updated = await prisma.knowledgeProposal.update({
    where: { id },
    data: { state: "TASK", decidedById: actor.id, decidedAt: new Date(), resultId: task.id },
  });
  await closeIfDone(proposal.batchId);
  await recordAudit({
    actorId: actor.id,
    action: "knowledge_proposal.to_task",
    entityType: "KnowledgeProposal",
    entityId: id,
    clientId: proposal.clientId,
    after: { taskId: task.id, title },
  });
  return { proposal: updated, taskId: task.id };
}

export type BulkResult = { done: string[]; failed: { id: string; error: string }[] };

/// Several proposals at once, each decided exactly as on its own, so every
/// check still runs per item and the audit log has a line per item
/// (marked bulk). One that cannot be decided is reported and the rest go
/// on: a bad item does not hold back the good ones.
export async function decideProposals(
  actor: User,
  ids: string[],
  decision: { approve: true } | { approve: false; reason: string }
): Promise<BulkResult> {
  assertCan(actor.role, "time_entry.create_self");
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) throw new Error("לא נבחרו הצעות.");
  if (unique.length > MAX_BULK) throw new Error(`עד ${MAX_BULK} הצעות בפעם אחת.`);
  if (!decision.approve && !decision.reason.trim()) throw new Error("צריך לכתוב בשורה אחת למה ההצעות נדחות.");
  const out: BulkResult = { done: [], failed: [] };
  for (const id of unique) {
    try {
      if (decision.approve) {
        const p = await prisma.knowledgeProposal.findUnique({ where: { id }, select: { clientId: true, target: true, action: true, flags: true, payload: true } });
        if (!p) throw new Error("ההצעה לא נמצאה.");
        // The flags as they stand now, as the card showed them.
        const existing = await findExisting(p.clientId, p.target, p.action, p.payload as Record<string, unknown>);
        const blocker = bulkApproveBlocker({
          action: p.action,
          flags: withLiveDuplicate((Array.isArray(p.flags) ? p.flags : []) as ProposalFlag[], p.target, existing) as ProposalFlag[],
          payload: p.payload as Record<string, unknown>,
        });
        if (blocker) throw new Error(`מאשרים אחת אחת: ${blocker}.`);
        await approveProposal(actor, id, {}, { bulk: true });
      } else {
        await rejectProposal(actor, id, decision.reason, { bulk: true });
      }
      out.done.push(id);
    } catch (err) {
      out.failed.push({ id, error: err instanceof Error ? err.message : "אירעה שגיאה." });
    }
  }
  return out;
}

/// Decision 1's measure: of the proposals decided in the window, how many
/// were changed before approval, and how many rejected.
export async function proposalQuality(actor: User, since: Date) {
  if (!canManageClients(actor.role)) throw new Error("רק למנהלים.");
  const rows = await prisma.knowledgeProposal.groupBy({
    by: ["state", "edited"],
    where: { decidedAt: { gte: since } },
    _count: { _all: true },
  });
  const count = (state: string, edited?: boolean) =>
    rows.filter((r) => r.state === state && (edited === undefined || r.edited === edited)).reduce((a, r) => a + r._count._all, 0);
  const approved = count("APPROVED");
  // When the first month started: decision 1 is decided after it.
  const first = await prisma.knowledgeProposal.findFirst({ where: { decidedAt: { not: null } }, orderBy: { decidedAt: "asc" }, select: { decidedAt: true } });
  return { approved, editedBeforeApproval: count("APPROVED", true), rejected: count("REJECTED"), firstDecidedAt: first?.decidedAt ?? null };
}
