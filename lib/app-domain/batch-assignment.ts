import "server-only";
import type { Prisma, SourceRestriction, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertCan } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { assertClientAccess } from "@/lib/app-domain/client-sources";
import { createTask } from "@/lib/app-domain/tasks";
import { findSecrets } from "@/lib/secret-scan";
import { missingRequired, payloadText, resolveKnowledgeStatus, type ProposalTargetLike } from "@/lib/knowledge-proposals";
import { assignmentReasonError, candidatesError, itemsForClient, waitingItemLine } from "@/lib/batch-assignment";
import { proposeKnowledge, type ProposalItemInput, type ProposeResult } from "@/lib/app-domain/knowledge-proposals";

// "ממתין לשיוך" (claude/org-brain-spec-2026-10-12.md, 5.1, step 3;
// decision 8).
//
// A meeting with a partner who serves several of Ankora's clients, and
// nobody on it who decides whose it is. Claude says which client it thinks
// and why, and the batch waits for a person. Until then it is in no file:
// no source in any register, no proposal, nothing a reader of one client
// could see. Only someone who may see every candidate client sees it,
// since its content belongs to one of them. Once a person picks, the batch
// is proposed to that client exactly as if Claude had sent it there, and
// reviewed as usual.
//
// Secrets are checked when it arrives, as for any batch: a dropped item's
// text is never stored, not even while it waits.

export type AwaitingInput = {
  proposedClientId: string;
  candidateClientIds: string[];
  reason: string;
  source: { title: string; occurredAt?: Date | null; participants?: string[]; externalIds?: string[]; restriction?: SourceRestriction };
  note?: string | null;
  items: ProposalItemInput[];
};

type StoredInput = {
  source: { title: string; occurredAt: string | null; participants: string[]; externalIds: string[]; restriction: SourceRestriction };
  items: { index: number; item: ProposalItemInput }[];
};

async function accessibleIds(actor: User): Promise<Set<string>> {
  return new Set((await listAccessibleClients(actor)).map((c) => c.id));
}

/// Claude is not sure whose meeting it was.
export async function proposeAwaitingAssignment(actor: User, input: AwaitingInput): Promise<{ batchId: string | null; waiting: number; dropped: ProposeResult["dropped"]; secretTaskId: string | null }> {
  assertCan(actor.role, "time_entry.create_self");
  const candidates = [...new Set(input.candidateClientIds)];
  const problem = candidatesError(input.proposedClientId, candidates) ?? assignmentReasonError(input.reason);
  if (problem) throw new Error(problem);
  for (const id of candidates) await assertClientAccess(actor, id);
  if (input.items.length === 0) throw new Error("אין פריטים באצווה.");
  if (input.items.length > 60) throw new Error("עד 60 פריטים באצווה. מחלקים לכמה אצוות.");
  const title = input.source.title.trim();
  if (!title) throw new Error("צריך שם לשיחה.");

  // The same recording, already someone's or already waiting.
  const ids = (input.source.externalIds ?? []).map((i) => i.trim()).filter(Boolean);
  if (ids.length > 0) {
    const registered = await prisma.clientSource.findMany({ where: { clientId: { in: candidates }, deletedAt: null }, select: { code: true, externalRefs: true, client: { select: { name: true } } } });
    const same = registered.find((s) => Array.isArray(s.externalRefs) && (s.externalRefs as { id?: string }[]).some((r) => r?.id && ids.includes(r.id)));
    if (same) throw new Error(`השיחה כבר רשומה אצל ${same.client.name} כ-${same.code}. שולחים אליו עם sourceCode.`);
    const waiting = await prisma.knowledgeBatch.findMany({ where: { awaitingAssignment: true }, select: { pendingInput: true } });
    if (waiting.some((b) => ((b.pendingInput as StoredInput | null)?.source.externalIds ?? []).some((id) => ids.includes(id)))) {
      throw new Error("השיחה הזו כבר ממתינה לשיוך.");
    }
  }

  const dropped: ProposeResult["dropped"] = [];
  const kept: StoredInput["items"] = [];
  for (const [index, item] of input.items.entries()) {
    const secrets = findSecrets([payloadText(item.payload), item.quote, item.reason].filter(Boolean).join("\n"));
    if (secrets.length > 0) {
      dropped.push({ index, reason: `נמצא ${secrets.map((s) => s.label).join(", ")}. הפריט לא נשמר.` });
      continue;
    }
    if (input.source.restriction === "TOPICS_ONLY" && item.quote?.trim()) {
      dropped.push({ index, reason: "המקור מוגבל לנושאים בלבד, ואסור לצטט ממנו." });
      continue;
    }
    // Spec 5.2: said now, not once a person has picked the client. The
    // status as proposeKnowledge reads it (31.10.2026).
    const status = resolveKnowledgeStatus({ ...item, target: item.target as ProposalTargetLike }, `items[${index}]`);
    if (!status.ok) {
      dropped.push({ index, reason: status.reason });
      continue;
    }
    const missing = missingRequired(item.target as ProposalTargetLike, status.payload, item.reason, `items[${index}]`);
    if (missing) {
      dropped.push({ index, reason: missing });
      continue;
    }
    kept.push({ index, item: { ...item, payload: status.payload } });
  }

  let secretTaskId: string | null = null;
  if (dropped.some((d) => d.reason.startsWith("נמצא"))) {
    // Whose meeting it was is not known yet; the secret was said anyway.
    const task = await createTask(actor, {
      clientId: input.proposedClientId,
      title: `להחליף סוד שנאמר בשיחה: ${title}`.slice(0, 200),
      description: "בשיחה שממתינה לשיוך נמצאו סיסמה, מפתח או מספר כרטיס. הם לא נשמרו. מי שנחשף להם צריך להחליף אותם, ולשמור את החדשים בכספת.",
      assignedToId: actor.id,
      priority: "HIGH",
    });
    secretTaskId = task.id;
  }
  if (kept.length === 0) return { batchId: null, waiting: 0, dropped, secretTaskId };

  const stored: StoredInput = {
    source: {
      title,
      occurredAt: input.source.occurredAt ? input.source.occurredAt.toISOString() : null,
      participants: (input.source.participants ?? []).map((p) => p.trim()).filter(Boolean),
      externalIds: ids,
      restriction: input.source.restriction ?? "NONE",
    },
    items: kept,
  };
  const batch = await prisma.knowledgeBatch.create({
    data: {
      clientId: input.proposedClientId,
      via: "MCP",
      note: input.note?.trim() || null,
      dropped: dropped as Prisma.InputJsonValue,
      awaitingAssignment: true,
      candidateClientIds: candidates,
      assignmentReason: input.reason.trim(),
      pendingInput: stored as unknown as Prisma.InputJsonValue,
      createdById: actor.id,
    },
  });
  await recordAudit({
    actorId: actor.id,
    action: "knowledge_batch.await_assignment",
    entityType: "KnowledgeBatch",
    entityId: batch.id,
    clientId: input.proposedClientId,
    after: { candidates, items: kept.length, dropped: dropped.length },
  });
  return { batchId: batch.id, waiting: kept.length, dropped, secretTaskId };
}

/// The batches waiting for a client that this person may decide: they
/// can see every candidate.
export async function listAwaitingAssignment(actor: User) {
  assertCan(actor.role, "time_entry.create_self");
  const mine = await accessibleIds(actor);
  const rows = (await prisma.knowledgeBatch.findMany({ where: { awaitingAssignment: true }, orderBy: { createdAt: "desc" } })).filter((b) =>
    b.candidateClientIds.every((id) => mine.has(id))
  );
  const clientIds = [...new Set(rows.flatMap((b) => b.candidateClientIds))];
  const userIds = [...new Set(rows.map((b) => b.createdById).filter((x): x is string => !!x))];
  const [clients, users] = await Promise.all([
    prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
  ]);
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  const userName = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((b) => {
    const input = b.pendingInput as unknown as StoredInput;
    return {
      id: b.id,
      createdAt: b.createdAt,
      createdByName: b.createdById ? (userName.get(b.createdById) ?? null) : null,
      note: b.note,
      reason: b.assignmentReason,
      proposedClientId: b.clientId,
      candidates: b.candidateClientIds.map((id) => ({ id, name: clientName.get(id) ?? "לקוח שהוסר" })),
      source: { title: input.source.title, occurredAt: input.source.occurredAt ? new Date(input.source.occurredAt) : null, participants: input.source.participants, topicsOnly: input.source.restriction === "TOPICS_ONLY" },
      items: input.items.map(({ item }) => waitingItemLine(item.target as ProposalTargetLike, item.payload)),
      droppedCount: Array.isArray(b.dropped) ? b.dropped.length : 0,
    };
  });
}

async function findWaiting(actor: User, batchId: string) {
  const batch = await prisma.knowledgeBatch.findUnique({ where: { id: batchId } });
  if (!batch || !batch.awaitingAssignment) throw new Error("השיחה כבר שויכה, או שהיא לא נמצאה.");
  for (const id of batch.candidateClientIds) await assertClientAccess(actor, id);
  return batch;
}

/// A person says whose meeting it was. The batch is proposed to that
/// client as if Claude had sent it there, and waits on the review screen
/// as any batch does.
export async function assignBatch(actor: User, batchId: string, clientId: string): Promise<ProposeResult & { clientId: string }> {
  assertCan(actor.role, "time_entry.create_self");
  const batch = await findWaiting(actor, batchId);
  if (!batch.candidateClientIds.includes(clientId)) throw new Error("הלקוח שנבחר אינו אחד המועמדים.");
  // Two people deciding at once: the first one takes it.
  const claimed = await prisma.knowledgeBatch.updateMany({ where: { id: batchId, awaitingAssignment: true }, data: { awaitingAssignment: false } });
  if (claimed.count === 0) throw new Error("השיחה כבר שויכה.");

  const input = batch.pendingInput as unknown as StoredInput;
  const same = clientId === batch.clientId;
  const prepared = itemsForClient(input.items, same);
  const dropped = [...((Array.isArray(batch.dropped) ? batch.dropped : []) as ProposeResult["dropped"]), ...prepared.dropped];
  let result: ProposeResult;
  try {
    result = prepared.items.length
      ? await proposeKnowledge(
          actor,
          {
            clientId,
            source: {
              kind: "TRANSCRIPT",
              title: input.source.title,
              occurredAt: input.source.occurredAt ? new Date(input.source.occurredAt) : null,
              participants: input.source.participants,
              externalIds: input.source.externalIds,
              restriction: input.source.restriction,
            },
            note: batch.note,
            via: batch.via,
            items: prepared.items,
          },
          { createdById: batch.createdById, dropped, indexes: prepared.indexes }
        )
      : { batchId: null, sourceCode: "", proposed: 0, dropped, secretTaskId: null, possibleMatches: [] };
  } catch (err) {
    await prisma.knowledgeBatch.update({ where: { id: batchId }, data: { awaitingAssignment: true } });
    throw err;
  }
  await prisma.knowledgeBatch.delete({ where: { id: batchId } });
  await recordAudit({
    actorId: actor.id,
    action: "knowledge_batch.assign",
    entityType: "KnowledgeBatch",
    entityId: result.batchId ?? batchId,
    clientId,
    after: { proposedClientId: batch.clientId, asProposed: same, reason: batch.assignmentReason, proposed: result.proposed, dropped: result.dropped.length },
  });
  return { ...result, clientId };
}

/// None of the candidates: the meeting is not any of these clients', or
/// nothing in it belongs in a file. Removed, with a line that says why.
export async function discardAwaiting(actor: User, batchId: string, why: string) {
  assertCan(actor.role, "time_entry.create_self");
  const batch = await findWaiting(actor, batchId);
  const line = why.trim();
  if (!line) throw new Error("כותבים בשורה אחת למה השיחה לא שייכת לאף אחד מהם.");
  const removed = await prisma.knowledgeBatch.deleteMany({ where: { id: batchId, awaitingAssignment: true } });
  if (removed.count === 0) throw new Error("השיחה כבר שויכה.");
  await recordAudit({
    actorId: actor.id,
    action: "knowledge_batch.discard",
    entityType: "KnowledgeBatch",
    entityId: batchId,
    clientId: batch.clientId,
    after: { candidates: batch.candidateClientIds, why: line.slice(0, 500) },
  });
}
