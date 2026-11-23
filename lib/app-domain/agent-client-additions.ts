import "server-only";
import { prisma } from "@/lib/prisma";
import { Prisma, type AgentClientAddition, type User } from "@prisma/client";
import { assertCan, canManageClients, ForbiddenError } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { findSecrets } from "@/lib/secret-scan";
import { DomainError } from "@/lib/domain-error";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { LIMITS, additionProblems, blockSchema, parseBlocks, parseParams, type AgentBlock, type VersionProblem } from "@/lib/agents/model";
import type { CompileAddition } from "@/lib/agents/compile";
import { z } from "zod";

// Client additions with versions of their own (24.11.2026, "סוכנים
// באנקורה: אפיון", "ירושה ופרמטרים"). Editing NUX's rule opens a draft of
// NUX's addition, not of the whole agent: a manager approves it, and from
// then on an installation working on NUX reads "גרסה 7 + NUX 2". The road
// is the agent version's road: a draft, a change note, a manager's
// approval, and an approved version is never edited.

const PROPOSE = "time_entry.create_self" as const;

/// The client, when this person may write for it and agents work on it.
async function workableClient(actor: User, clientId: string) {
  const client = (await listAccessibleClients(actor)).find((c) => c.id === clientId);
  if (!client) throw new DomainError("agents.clientForbidden", "אין לך גישה ללקוח הזה.");
  if (client.aiExcluded) throw new DomainError("agents.clientAiExcluded", "הלקוח מסומן \"בלי AI\", וסוכנים לא עובדים עליו.");
  return client;
}

const additionInput = z.object({
  blocks: z.array(blockSchema).max(LIMITS.blocks).optional(),
  changeNote: z.string().max(2000).nullish(),
});
export type AdditionInput = z.input<typeof additionInput>;

/// An addition's block: no client of its own (the row has it), and never overridable itself.
const asAdditionBlock = (b: AgentBlock): AgentBlock => ({ ...b, clientId: null, overridable: false, replaces: b.replaces || null });

export async function saveClientAddition(actor: User, input: { agentId: string; clientId: string } & AdditionInput) {
  assertCan(actor.role, PROPOSE);
  const parsed = additionInput.safeParse({ blocks: input.blocks, changeNote: input.changeNote });
  if (!parsed.success) throw new DomainError("agents.invalidDraft", `התוספת לא תקינה: ${parsed.error.issues[0]?.message ?? ""}`.trim());
  const { blocks, changeNote } = parsed.data;
  const agent = await prisma.agent.findUnique({ where: { id: input.agentId }, select: { id: true, archivedAt: true } });
  if (!agent || agent.archivedAt) throw new DomainError("agents.notFound", "הסוכן לא נמצא.");
  await workableClient(actor, input.clientId);
  const texts = [...(blocks ?? []).flatMap((b) => [b.title, b.body, b.why ?? ""]), changeNote ?? ""];
  if (texts.some((t) => findSecrets(t).length > 0)) throw new DomainError("agents.hasSecret", "בתוספת יש סיסמה, מפתח או טוקן. סודות לא נכתבים בסוכן.");

  const where = { agentId: input.agentId, clientId: input.clientId };
  let open = await prisma.agentClientAddition.findFirst({ where: { ...where, state: { in: ["DRAFT", "PENDING"] } } });
  if (open?.state === "PENDING") throw new DomainError("agents.additionPending", "לתוספת של הלקוח הזה יש גרסה שממתינה לאישור. צריך לאשר או לדחות אותה לפני שינוי נוסף.");
  if (!open) {
    const approved = await prisma.agentClientAddition.findFirst({ where: { ...where, state: "APPROVED" }, orderBy: { version: "desc" } });
    const last = await prisma.agentClientAddition.findFirst({ where, orderBy: { version: "desc" }, select: { version: true } });
    try {
      open = await prisma.agentClientAddition.create({ data: { ...where, version: (last?.version ?? 0) + 1, createdById: actor.id, blocks: (approved?.blocks ?? []) as Prisma.InputJsonValue } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new DomainError("agents.draftRace", "מישהו אחר פתח טיוטה באותו רגע. כדאי לרענן ולנסות שוב.");
      throw err;
    }
  }
  const updated = await prisma.agentClientAddition.update({
    where: { id: open.id },
    data: {
      ...(blocks ? { blocks: blocks.map(asAdditionBlock) as Prisma.InputJsonValue } : {}),
      ...(changeNote !== undefined ? { changeNote: changeNote?.trim() || null } : {}),
    },
  });
  await recordAudit({ actorId: actor.id, action: "agent.addition_save", entityType: "AgentClientAddition", entityId: updated.id, after: { agentId: input.agentId, clientId: input.clientId, version: updated.version } });
  return updated;
}

/// What stops this addition from being sent or approved, checked against
/// the agent's version in use (the blocks it may replace, the parameters).
export async function clientAdditionProblems(row: Pick<AgentClientAddition, "agentId" | "blocks" | "changeNote">) {
  const agentVersion = await prisma.agentVersion.findFirst({ where: { agentId: row.agentId, state: "APPROVED", faultyAt: null }, orderBy: { version: "desc" }, select: { blocks: true, params: true } });
  return additionProblems({ blocks: parseBlocks(row.blocks), agentBlocks: parseBlocks(agentVersion?.blocks), params: parseParams(agentVersion?.params), changeNote: row.changeNote });
}

export async function submitClientAddition(actor: User, additionId: string) {
  assertCan(actor.role, PROPOSE);
  const row = await prisma.agentClientAddition.findUnique({ where: { id: additionId } });
  if (!row || row.state !== "DRAFT") throw new DomainError("agents.notDraft", "אין טיוטה פתוחה לשלוח.");
  await workableClient(actor, row.clientId);
  if (!row.changeNote?.trim()) throw new DomainError("agents.changeNoteRequired", "צריך לכתוב בשורה מה השתנה ולמה. זה מה שאנשים יראו כשיציעו להם לעדכן.");
  const problems = await clientAdditionProblems(row);
  if (problems.length) throw new DomainError("agents.draftProblems", `לפני השליחה: ${problems.map((p) => p.text).join(" ")}`);
  const updated = await prisma.agentClientAddition.update({ where: { id: row.id }, data: { state: "PENDING", submittedAt: new Date() } });
  await recordAudit({ actorId: actor.id, action: "agent.addition_submit", entityType: "AgentClientAddition", entityId: row.id, after: { version: row.version } });
  return updated;
}

export async function discardClientAddition(actor: User, additionId: string) {
  assertCan(actor.role, PROPOSE);
  const row = await prisma.agentClientAddition.findUnique({ where: { id: additionId } });
  if (!row || row.state !== "DRAFT") throw new DomainError("agents.notDraft", "אין טיוטה פתוחה לבטל.");
  await workableClient(actor, row.clientId);
  await prisma.agentClientAddition.delete({ where: { id: row.id } });
  await recordAudit({ actorId: actor.id, action: "agent.addition_discard", entityType: "AgentClientAddition", entityId: row.id, after: { version: row.version } });
}

async function pendingAddition(actor: User, additionId: string) {
  if (!canManageClients(actor.role)) throw new ForbiddenError("רק מנהל מאשר גרסה של סוכן.");
  const row = await prisma.agentClientAddition.findUnique({ where: { id: additionId } });
  if (!row) throw new DomainError("agents.versionNotFound", "הגרסה לא נמצאה.");
  if (row.state !== "PENDING") throw new DomainError("agents.alreadyDecided", "הגרסה לא ממתינה לאישור.");
  await workableClient(actor, row.clientId);
  return row;
}

export async function approveClientAddition(actor: User, additionId: string) {
  const row = await pendingAddition(actor, additionId);
  const problems = await clientAdditionProblems(row);
  if (problems.length) throw new DomainError("agents.draftProblems", `לפני האישור: ${problems.map((p) => p.text).join(" ")}`);
  const updated = await prisma.agentClientAddition.update({ where: { id: row.id }, data: { state: "APPROVED", decidedById: actor.id, decidedAt: new Date() } });
  await recordAudit({ actorId: actor.id, action: "agent.addition_approve", entityType: "AgentClientAddition", entityId: row.id, after: { agentId: row.agentId, clientId: row.clientId, version: row.version } });
  return updated;
}

export async function rejectClientAddition(actor: User, additionId: string, reason: string) {
  const row = await pendingAddition(actor, additionId);
  const why = reason.trim();
  if (!why) throw new DomainError("agents.reasonRequired", "צריך לכתוב בשורה אחת למה.");
  const updated = await prisma.agentClientAddition.update({ where: { id: row.id }, data: { state: "REJECTED", decidedById: actor.id, decidedAt: new Date(), rejectReason: why } });
  await recordAudit({ actorId: actor.id, action: "agent.addition_reject", entityType: "AgentClientAddition", entityId: row.id, after: { version: row.version, reason: why } });
  return updated;
}

export async function isClientAddition(id: string): Promise<boolean> {
  return (await prisma.agentClientAddition.count({ where: { id } })) > 0;
}

/// The newest approved addition of each of these clients: what the
/// compiler adds after the agent's own blocks.
export async function approvedAdditions(agentId: string, clientIds: string[]): Promise<CompileAddition[]> {
  if (clientIds.length === 0) return [];
  const rows = await prisma.agentClientAddition.findMany({ where: { agentId, clientId: { in: clientIds }, state: "APPROVED" }, orderBy: { version: "desc" }, select: { clientId: true, version: true, blocks: true } });
  const out = new Map<string, CompileAddition>();
  for (const r of rows) if (!out.has(r.clientId)) out.set(r.clientId, { clientId: r.clientId, version: r.version, blocks: parseBlocks(r.blocks) });
  return [...out.values()];
}

/// The additions of an agent for the clients this person can see, for the
/// instructions screen: per client, the version in use and the open draft.
export async function listClientAdditions(actor: User, agentId: string) {
  assertCan(actor.role, PROPOSE);
  const clients = await listAccessibleClients(actor);
  const name = new Map(clients.map((c) => [c.id, c.name]));
  const rows = await prisma.agentClientAddition.findMany({ where: { agentId, clientId: { in: clients.map((c) => c.id) }, state: { in: ["APPROVED", "DRAFT", "PENDING"] } }, orderBy: { version: "desc" } });
  const out: { clientId: string; clientName: string; approved: AgentClientAddition | null; open: AgentClientAddition | null; problems: VersionProblem[] }[] = [];
  for (const id of [...new Set(rows.map((r) => r.clientId))]) {
    const approved = rows.find((r) => r.clientId === id && r.state === "APPROVED") ?? null;
    const open = rows.find((r) => r.clientId === id && (r.state === "DRAFT" || r.state === "PENDING")) ?? null;
    const problems = open ? await clientAdditionProblems(open) : [];
    out.push({ clientId: id, clientName: name.get(id) ?? "", approved, open, problems });
  }
  return out.sort((a, b) => a.clientName.localeCompare(b.clientName, "he"));
}
