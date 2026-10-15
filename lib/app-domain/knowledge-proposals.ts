import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma, User, SourceKind, SourceRestriction } from "@prisma/client";
import { assertCan, canManageClients } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { findSecrets } from "@/lib/secret-scan";
import { normalizeEmail } from "@/lib/contact-normalize";
import { readSourceRefs, type SourceRef } from "@/lib/knowledge-sources";
import {
  PAYLOADS,
  normalizeForMatch,
  payloadText,
  proposalHeadline,
  type ProposalActionLike,
  type ProposalFlag,
  type ProposalTargetLike,
} from "@/lib/knowledge-proposals";
import { addClientSource, assertClientAccess } from "@/lib/app-domain/client-sources";
import { addClientContact, addClientOrganization } from "@/lib/app-domain/client-contacts";
import { addClientFact, recordContradiction, supersedeClientFact } from "@/lib/app-domain/client-facts";
import { addSystemAccess } from "@/lib/app-domain/system-map";
import { addRequestType } from "@/lib/app-domain/request-types";
import { createTask } from "@/lib/app-domain/tasks";

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
async function flagsFor(clientId: string, item: ProposalItemInput & { payload: Record<string, unknown> }, sourceWeight: string): Promise<ProposalFlag[]> {
  const flags: ProposalFlag[] = [];
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
  return flags;
}

export async function proposeKnowledge(actor: User, input: ProposeInput): Promise<ProposeResult> {
  assertCan(actor.role, "time_entry.create_self");
  await assertClientAccess(actor, input.clientId);
  if (input.items.length === 0) throw new Error("אין פריטים באצווה.");
  if (input.items.length > MAX_ITEMS) throw new Error(`עד ${MAX_ITEMS} פריטים באצווה. מחלקים לכמה אצוות.`);

  const source = await resolveSource(actor, input.clientId, input.source);
  const dropped: ProposeResult["dropped"] = [];
  const accepted: { item: ProposalItemInput & { action: ProposalActionLike }; payload: Record<string, unknown>; flags: ProposalFlag[] }[] = [];

  for (const [index, raw] of input.items.entries()) {
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
    const payload = { ...(parsed.data as Record<string, unknown>), sources: refs };
    accepted.push({ item, payload, flags: await flagsFor(input.clientId, { ...item, payload }, source.weight) });
  }

  let secretTaskId: string | null = null;
  if (dropped.some((d) => d.reason.startsWith("נמצא"))) {
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
      createdById: actor.id,
      proposals: {
        create: accepted.map(({ item, payload, flags }) => ({
          clientId: input.clientId,
          target: item.target,
          action: item.action,
          targetId: item.targetId ?? null,
          payload: payload as Prisma.InputJsonValue,
          reason: item.reason?.trim() || null,
          quote: item.quote?.trim() || null,
          flags: flags as Prisma.InputJsonValue,
        })),
      },
    },
  });
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
    where: { clientId: { in: clientIds }, closedAt: null },
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
  return batches.map((b) => ({
    ...b,
    source: b.sourceId ? sourceById.get(b.sourceId) ?? null : null,
    createdByName: b.createdById ? nameOf.get(b.createdById) ?? null : null,
    proposals: b.proposals.map((p) => ({ ...p, existing: p.targetId ? targetById.get(p.targetId) ?? null : null })),
  }));
}

export async function countPendingProposals(actor: User, clientId?: string): Promise<number> {
  const accessible = (await listAccessibleClients(actor)).map((c) => c.id);
  return prisma.knowledgeProposal.count({
    where: { state: "PENDING", clientId: clientId ? { in: accessible.filter((id) => id === clientId) } : { in: accessible } },
  });
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
async function apply(actor: User, p: { clientId: string; target: string; action: string; targetId: string | null }, payload: Record<string, unknown>) {
  const date = (v: unknown) => (typeof v === "string" && v ? new Date(`${v}T00:00:00Z`) : null);
  const sources = readSourceRefs(payload.sources);
  if (p.target === "FACT") {
    const f = PAYLOADS.FACT.parse(payload);
    const input = { ...f, sources, validUntil: date(f.validUntil), decidedAt: date(f.decidedAt) };
    if (p.action === "SUPERSEDE") return (await supersedeClientFact(actor, p.targetId!, input)).id;
    if (p.action === "CONTRADICT") return (await recordContradiction(actor, p.targetId!, { value: f.body, sources })).id;
    return (await addClientFact(actor, { ...input, clientId: p.clientId })).id;
  }
  if (p.target === "CONTACT") return (await addClientContact(actor, { ...PAYLOADS.CONTACT.parse(payload), sources, clientId: p.clientId })).id;
  if (p.target === "ORGANIZATION") return (await addClientOrganization(actor, { ...PAYLOADS.ORGANIZATION.parse(payload), sources, clientId: p.clientId })).id;
  if (p.target === "REQUEST_TYPE") return (await addRequestType(actor, { ...PAYLOADS.REQUEST_TYPE.parse(payload), sources, clientId: p.clientId })).id;
  if (p.target === "SYSTEM") return (await addSystemAccess(actor, { ...PAYLOADS.SYSTEM.parse(payload), sources, clientId: p.clientId })).id;
  throw new Error("סוג פריט לא מוכר.");
}

export async function approveProposal(actor: User, id: string, edits: Record<string, unknown> = {}) {
  assertCan(actor.role, "time_entry.create_self");
  const proposal = await findPending(actor, id);
  const original = proposal.payload as Record<string, unknown>;
  const changed = Object.entries(edits).filter(([k, v]) => k !== "sources" && JSON.stringify(original[k] ?? null) !== JSON.stringify(v ?? null));
  const payload = { ...original, ...Object.fromEntries(changed) };
  // An edit is checked for secrets like the original was.
  if (changed.length > 0 && findSecrets(payloadText(Object.fromEntries(changed))).length > 0) {
    throw new Error("בעריכה יש סיסמה, מפתח או מספר כרטיס. סודות נשמרים בכספת, לא בתיק.");
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
    after: { resultId, edited: changed.length > 0, headline: proposalHeadline(proposal.target, payload) },
  });
  return updated;
}

export async function rejectProposal(actor: User, id: string, reason: string) {
  assertCan(actor.role, "time_entry.create_self");
  const proposal = await findPending(actor, id);
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
    after: { reason: why },
  });
  return updated;
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
  return { approved, editedBeforeApproval: count("APPROVED", true), rejected: count("REJECTED") };
}
