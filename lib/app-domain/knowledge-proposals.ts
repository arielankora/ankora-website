import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma, User, SourceKind, SourceRestriction, TaskPriority } from "@prisma/client";
import { assertCan, canManageClients } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { findSecrets } from "@/lib/secret-scan";
import { normalizeDomain, normalizeEmail } from "@/lib/contact-normalize";
import { readSourceRefs, type SourceRef } from "@/lib/knowledge-sources";
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
  CONFIDENCE_LEVELS,
  type ConfidenceLike,
  firefliesLink,
  taskBlocker,
  taskFromProposal,
  TASK_TITLE_MAX,
} from "@/lib/knowledge-proposals";
import { addClientDomain, addClientSource, assertClientAccess } from "@/lib/app-domain/client-sources";
import { addClientEntity } from "@/lib/app-domain/client-entities";
import { NarrativeConflictError, saveNarrative } from "@/lib/app-domain/client-narratives";
import { addProcess, saveProcessVersion } from "@/lib/app-domain/processes";
import { addClientContact, addClientOrganization } from "@/lib/app-domain/client-contacts";
import { addClientFact, recordContradiction, supersedeClientFact } from "@/lib/app-domain/client-facts";
import { addSystemAccess } from "@/lib/app-domain/system-map";
import { addRequestType } from "@/lib/app-domain/request-types";
import { addClientPolicy } from "@/lib/app-domain/client-policies";
import { createTask } from "@/lib/app-domain/tasks";
import { assertCanApproveForClient, canApproveForClient, notifyRuleApprovers, ruleApproversFor } from "@/lib/app-domain/rule-approvals";

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
  sourceCode: string;
  proposed: number;
  dropped: { index: number; reason: string }[];
  secretTaskId: string | null;
};

const MAX_ITEMS = 60;

/// Rule R6 (spec 7.2, decision 5): a proposal marked sensitive (medical,
/// political, personal, or whatever the client's data-handling rules call
/// sensitive) is read and decided only by the client's approvers.
export function isSensitive(payload: unknown): boolean {
  return !!payload && typeof payload === "object" && (payload as Record<string, unknown>).sensitivity === "SENSITIVE";
}

export const SENSITIVE_PROPOSED = "knowledge.sensitive_proposed";

/// The batch's source: an existing code, the source already registered
/// for the same recording, or a new one.
async function resolveSource(actor: User, clientId: string, source: BatchSourceInput) {
  if ("code" in source) {
    const found = await prisma.clientSource.findFirst({ where: { clientId, code: source.code.trim().toUpperCase(), deletedAt: null } });
    if (!found) throw new Error(`המקור ${source.code} לא קיים במרשם של הלקוח.`);
    return found;
  }
  const ids = (source.externalIds ?? []).map((i) => i.trim()).filter(Boolean);
  if (ids.length > 0) {
    const existing = await prisma.clientSource.findMany({ where: { clientId, deletedAt: null }, orderBy: { seq: "asc" } });
    const same = existing.find((s) => Array.isArray(s.externalRefs) && (s.externalRefs as { id?: string }[]).some((r) => r?.id && ids.includes(r.id)));
    if (same) return same;
  }
  return addClientSource(actor, {
    clientId,
    kind: source.kind,
    title: source.title,
    occurredAt: source.occurredAt ?? null,
    participants: source.participants,
    externalIds: ids,
    restriction: source.restriction,
  });
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
  if (sourceWeight === "SECONDARY" && (item.payload.knowledgeStatus ?? "CONFIRMED") === "CONFIRMED" && (item.alsoSources ?? []).length === 0) {
    flags.push({ code: "R14", message: "המקור הוא מסמך של אנקורה, ולכן הפריט יישמר כלא ודאי." });
  }
  if (item.target === "FACT" && item.action === "CREATE") {
    const body = normalizeForMatch(String(item.payload.body ?? ""));
    const same = await prisma.clientFact.findMany({
      where: { clientId, deletedAt: null, knowledgeStatus: { not: "SUPERSEDED" }, kind: item.payload.kind as never },
      select: { body: true },
    });
    if (body && same.some((f) => normalizeForMatch(f.body) === body)) flags.push({ code: "DUPLICATE", message: "אותו פריט כבר קיים בתיק." });
  }
  if (item.target === "CONTACT") {
    const emails = ((item.payload.emails as string[] | undefined) ?? []).map((e) => normalizeEmail(e)).filter((e): e is string => !!e);
    if (emails.length > 0) {
      const known = await prisma.clientContact.count({ where: { clientId, deletedAt: null, person: { emails: { hasSome: emails } } } });
      if (known) flags.push({ code: "DUPLICATE", message: "איש קשר עם המייל הזה כבר בתיק." });
    }
  }
  if (item.target === "ORGANIZATION") {
    const name = String(item.payload.name ?? "").trim();
    const known = await prisma.clientOrganization.count({
      where: { clientId, deletedAt: null, organization: { name: { equals: name, mode: "insensitive" } } },
    });
    if (known) flags.push({ code: "DUPLICATE", message: "הארגון כבר בתיק." });
  }
  if (isSensitive(item.payload)) {
    flags.push({ code: "R6", message: "מידע רגיש: רק מי שמאשר מידע רגיש אצל הלקוח רואה את הפריט ומחליט עליו." });
  }
  if (item.target === "ENTITY") {
    const name = String(item.payload.name ?? "").trim();
    const known = await prisma.clientEntity.count({ where: { clientId, deletedAt: null, name: { equals: name, mode: "insensitive" } } });
    if (known) flags.push({ code: "DUPLICATE", message: "ישות בשם הזה כבר בתיק." });
  }
  if (item.target === "NARRATIVE") {
    const latest = await prisma.clientNarrative.findFirst({ where: { clientId, kind: item.payload.kind as never }, orderBy: { version: "desc" }, select: { body: true } });
    if (latest && normalizeForMatch(latest.body) === normalizeForMatch(String(item.payload.body ?? ""))) flags.push({ code: "DUPLICATE", message: "זה כבר הטקסט שבתיק." });
    flags.push({ code: "NARRATIVE", message: latest ? "באישור, הטקסט הזה מחליף את הגרסה שבתיק (הקודמת נשמרת בהיסטוריה)." : "באישור, זו הגרסה הראשונה של הטקסט." });
  }
  if (item.target === "PROCESS") {
    const title = normalizeForMatch(String(item.payload.title ?? ""));
    const known = await prisma.process.findMany({ where: { clientId, deletedAt: null, status: { not: "RETIRED" } }, select: { title: true } });
    if (known.some((k) => normalizeForMatch(k.title) === title)) flags.push({ code: "DUPLICATE", message: "תהליך בשם הזה כבר בתיק." });
    flags.push({ code: "PROCESS", message: "באישור, התהליך נכנס כטיוטה. הנוהל רץ רק אחרי שמנהל מאשר אותו במסך התהליכים." });
  }
  if (item.target === "DOMAIN") {
    const domain = normalizeDomain(String(item.payload.domain ?? ""));
    const known = domain ? await prisma.clientDomain.count({ where: { clientId, domain, deletedAt: null } }) : 0;
    if (known) flags.push({ code: "DUPLICATE", message: "הדומיין כבר בתיק." });
  }
  if (item.target === "POLICY") {
    const title = normalizeForMatch(String(item.payload.title ?? ""));
    const statement = normalizeForMatch(String(item.payload.statement ?? ""));
    const known = await prisma.clientPolicy.findMany({ where: { clientId, deletedAt: null, status: { not: "RETIRED" } }, select: { title: true, statement: true } });
    if (known.some((k) => normalizeForMatch(k.statement) === statement || (title && normalizeForMatch(k.title) === title))) {
      flags.push({ code: "DUPLICATE", message: "כלל עם אותו שם או אותו נוסח כבר בתיק." });
    }
    flags.push({ code: "POLICY", message: "באישור, הכלל נכנס לתיק כמוצע. מנהל מאשר אותו בנפרד כדי שייכנס לתוקף." });
  }
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

  const source = await resolveSource(actor, input.clientId, input.source);
  const codes = await registerCodes(input.clientId);
  const dropped: ProposeResult["dropped"] = [...(options.dropped ?? [])];
  const accepted: { item: ProposalItemInput & { action: ProposalActionLike }; payload: Record<string, unknown>; flags: ProposalFlag[] }[] = [];

  for (const [i, raw] of input.items.entries()) {
    const index = options.indexes?.[i] ?? i;
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
    // Spec 5.2: a reason and a status, or it is not read at all.
    const missing = missingRequired(item.target, item.payload ?? {}, item.reason);
    if (missing) {
      dropped.push({ index, reason: missing });
      continue;
    }
    const parsed = schema.safeParse(item.payload);
    if (!parsed.success) {
      dropped.push({ index, reason: `הפריט לא בנוי נכון: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}` });
      continue;
    }
    if (item.action !== "CREATE") {
      if (item.target !== "FACT" || !item.targetId) {
        dropped.push({ index, reason: "החלפה וסתירה הן רק של עובדה קיימת, עם המזהה שלה." });
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
    accepted.push({ item, payload, flags: await flagsFor(input.clientId, { ...item, payload }, source.weight, codes) });
  }

  let secretTaskId: string | null = null;
  // A secret dropped before the batch waited for its client already has its task.
  if (dropped.slice(options.dropped?.length ?? 0).some((d) => d.reason.startsWith("נמצא"))) {
    // The secret was said; it has to be changed. The task says where, never what.
    const task = await createTask(actor, {
      clientId: input.clientId,
      title: `להחליף סוד שנאמר ב-${source.code}: ${source.title}`.slice(0, 200),
      description: "בהצעות מהמקור הזה נמצאו סיסמה, מפתח או מספר כרטיס. הם לא נשמרו בתיק. מי שנחשף להם צריך להחליף אותם, ולשמור את החדשים בכספת.",
      assignedToId: actor.id,
      priority: "HIGH",
    });
    secretTaskId = task.id;
  }

  if (accepted.length === 0) {
    return { batchId: null, sourceCode: source.code, proposed: 0, dropped, secretTaskId };
  }

  const batch = await prisma.knowledgeBatch.create({
    data: {
      clientId: input.clientId,
      sourceId: source.id,
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
  const sensitive = accepted.filter(({ payload }) => isSensitive(payload)).length;
  if (sensitive > 0) {
    const client = await prisma.client.findUniqueOrThrow({ where: { id: input.clientId }, select: { name: true } });
    await notifyRuleApprovers(input.clientId, actor.id, {
      type: SENSITIVE_PROPOSED,
      title: `${client.name}: מידע רגיש ממתין לאישור שלך`,
      body: `${sensitive === 1 ? "פריט רגיש אחד" : `${sensitive} פריטים רגישים`} מ-${source.code} ${source.title}. רק מי שמאשר מידע רגיש אצל הלקוח רואה אותם.`.slice(0, 500),
      entityType: "Knowledge",
    });
  }
  await recordAudit({
    actorId: actor.id,
    action: "knowledge_batch.propose",
    entityType: "KnowledgeBatch",
    entityId: batch.id,
    clientId: input.clientId,
    after: { sourceCode: source.code, proposed: accepted.length, dropped: dropped.length },
  });
  return { batchId: batch.id, sourceCode: source.code, proposed: accepted.length, dropped, secretTaskId };
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
      client: { select: { id: true, name: true } },
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
  const targetById = new Map(targets.map((t) => [t.id, t]));
  // R6: a sensitive proposal is shown to the client's approvers only.
  // Everyone else sees that one is waiting, and for whom, not what it says.
  const approverOf = new Map<string, boolean>();
  const approverNames = new Map<string, string>();
  for (const clientId of new Set(batches.filter((b) => b.proposals.some((p) => isSensitive(p.payload))).map((b) => b.clientId))) {
    approverOf.set(clientId, await canApproveForClient(actor, clientId));
    approverNames.set(clientId, (await ruleApproversFor(clientId)).map((u) => u.name).join(" או "));
  }
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
            hiddenFor: approverNames.get(b.clientId) || "מי שמאשר מידע רגיש",
          }
        : { ...p, existing: p.targetId ? targetById.get(p.targetId) ?? null : null, hiddenFor: null as string | null };
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

async function apply(actor: User, p: { clientId: string; target: string; action: string; targetId: string | null }, payload: Record<string, unknown>) {
  const date = (v: unknown) => (typeof v === "string" && v ? new Date(`${v}T00:00:00Z`) : null);
  const sources = readSourceRefs(payload.sources);
  const ownerId = await ownerByName(payload.ownerName);
  // Named, or nothing: an item without an owner keeps the one it has.
  const owner = ownerId ? { ownerId } : {};
  if (p.target === "FACT") {
    const f = PAYLOADS.FACT.parse(payload);
    const { ownerName: _o, ...fact } = f;
    const input = { ...fact, ...owner, sources, validUntil: date(f.validUntil), decidedAt: date(f.decidedAt) };
    if (p.action === "SUPERSEDE") return (await supersedeClientFact(actor, p.targetId!, input)).id;
    if (p.action === "CONTRADICT") return (await recordContradiction(actor, p.targetId!, { value: f.body, sources })).id;
    return (await addClientFact(actor, { ...input, clientId: p.clientId })).id;
  }
  if (p.target === "CONTACT") return (await addClientContact(actor, { ...withoutOwnerName(PAYLOADS.CONTACT.parse(payload)), ...owner, sources, clientId: p.clientId })).id;
  if (p.target === "ORGANIZATION") return (await addClientOrganization(actor, { ...withoutOwnerName(PAYLOADS.ORGANIZATION.parse(payload)), ...owner, sources, clientId: p.clientId })).id;
  if (p.target === "REQUEST_TYPE") return (await addRequestType(actor, { ...withoutOwnerName(PAYLOADS.REQUEST_TYPE.parse(payload)), ...owner, sources, clientId: p.clientId })).id;
  // A rule enters the file as "proposed": approving the proposal records
  // what the client said; making it binding is a manager's separate step.
  if (p.target === "POLICY") {
    const r = withoutOwnerName(PAYLOADS.POLICY.parse(payload));
    return (await addClientPolicy(actor, { ...r, effectiveFrom: date(r.effectiveFrom), reviewBy: date(r.reviewBy), ...owner, sources, clientId: p.clientId })).id;
  }
  if (p.target === "SYSTEM") return (await addSystemAccess(actor, { ...withoutOwnerName(PAYLOADS.SYSTEM.parse(payload)), ...owner, sources, clientId: p.clientId })).id;
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
    const { steps, highlights, outputs, ownerName: _o, ...proc } = PAYLOADS.PROCESS.parse(payload);
    const process = await addProcess(actor, { ...proc, ...owner, sources, clientId: p.clientId });
    if (steps?.length) await saveProcessVersion(actor, process.id, { steps, highlights, outputs, baseVersion: 0 });
    return process.id;
  }
  if (p.target === "DOMAIN") return (await addClientDomain(actor, { ...PAYLOADS.DOMAIN.parse(payload), clientId: p.clientId })).id;
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
  input: { title?: string | null; description?: string | null; assignedToId?: string | null; dueDate?: Date | null; priority?: TaskPriority | null } = {}
) {
  assertCan(actor.role, "time_entry.create_self");
  const proposal = await findPending(actor, id);
  const blocker = taskBlocker({ payload: (proposal.payload ?? {}) as Record<string, unknown> });
  if (blocker) throw new Error(blocker);
  const draft = await draftFor(proposal);
  const title = (input.title?.trim() || draft.title).slice(0, TASK_TITLE_MAX);
  const description = input.description?.trim() || draft.description;
  // The same check as on the way in: what the person typed is not saved
  // if it holds a password, a key or a card number.
  if (findSecrets(`${title}\n${description}`).length > 0) throw new Error("בטקסט יש סיסמה, מפתח או מספר כרטיס. צריך להסיר אותם לפני שפותחים משימה.");
  const task = await createTask(actor, {
    clientId: proposal.clientId,
    title,
    description,
    assignedToId: input.assignedToId || actor.id,
    dueDate: input.dueDate ?? null,
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
        const p = await prisma.knowledgeProposal.findUnique({ where: { id }, select: { action: true, flags: true, payload: true } });
        if (!p) throw new Error("ההצעה לא נמצאה.");
        const blocker = bulkApproveBlocker({
          action: p.action,
          flags: (Array.isArray(p.flags) ? p.flags : []) as ProposalFlag[],
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
