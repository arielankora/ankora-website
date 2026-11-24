import "server-only";
import { prisma } from "@/lib/prisma";
import { Prisma, type AgentVersion, type User } from "@prisma/client";
import { outgoingForUser } from "@/lib/i18n/recipients";
import type { OutgoingT } from "@/lib/i18n/outgoing";
import { assertCan, canManageClients, ForbiddenError } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { findSecrets } from "@/lib/secret-scan";
import { DomainError } from "@/lib/domain-error";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { aiExcludedClientIds } from "@/lib/app-domain/ai-exclusion-db";
import { LIMITS, fileSchema, skillOf, parseBlocks, parseFiles, parseParams, parseRequirements, requirementsSchema, versionProblems, blockSchema, paramSchema, type AgentBlock, type AgentFile, type AgentParam, type AgentRequirements } from "@/lib/agents/model";
import { compileAgent, isCheckDue, type CompileClient } from "@/lib/agents/compile";
import type { LinkedProcedure } from "@/lib/agents/procedure";
import { mcpGetProcess } from "@/lib/app-domain/mcp-processes";
import { approvedLibrary } from "@/lib/app-domain/agent-library";
import { approvedAdditions } from "@/lib/app-domain/agent-client-additions";
import { activeAgentCategories, categoriesOf } from "@/lib/app-domain/agent-categories";
import { z } from "zod";

// Agents, phase 1 (22.11.2026, "סוכנים באנקורה: אפיון").
//
// Same road as the extraction guidance: anybody on the team writes a
// draft, a manager approves it, and only an approved version reaches the
// installations. A version is never edited after it leaves DRAFT. An
// installation is pinned to a version; a newer approved one is offered to
// it when its check is due, and taken silently when it changes nothing
// for that installation (a client addition for another client).

const PROPOSE = "time_entry.create_self" as const;

function assertApprover(actor: User) {
  if (!canManageClients(actor.role)) throw new ForbiddenError("רק מנהל מאשר גרסה של סוכן.");
}

export type VersionContent = { blocks: AgentBlock[]; params: AgentParam[]; requirements: AgentRequirements; actionLevel: AgentVersion["actionLevel"]; files: AgentFile[] };

export function contentOf(v: Pick<AgentVersion, "blocks" | "params" | "requirements" | "actionLevel"> & { files?: AgentVersion["files"] }): VersionContent {
  return { blocks: parseBlocks(v.blocks), params: parseParams(v.params), requirements: parseRequirements(v.requirements), actionLevel: v.actionLevel, files: parseFiles(v.files) };
}

/// The version in use: the newest approved one that no manager marked faulty.
async function currentApproved(agentId: string) {
  return prisma.agentVersion.findFirst({ where: { agentId, state: "APPROVED", faultyAt: null }, orderBy: { version: "desc" } });
}

async function namesOf(ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  const rows = unique.length ? await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } }) : [];
  return new Map(rows.map((u) => [u.id, u.name]));
}

// --- Reading ----------------------------------------------------------------

export async function listAgents(actor: User) {
  assertCan(actor.role, PROPOSE);
  const agents = await prisma.agent.findMany({
    where: { archivedAt: null },
    orderBy: { name: "asc" },
    include: {
      versions: { select: { id: true, version: true, state: true, faultyAt: true }, orderBy: { version: "desc" } },
      installations: { where: { status: "ACTIVE" }, select: { id: true, userId: true, surface: true, pinnedVersionId: true, clientScope: true, clientIds: true, runs: { orderBy: { createdAt: "desc" }, take: 1, select: { outcome: true } } } },
    },
  });
  const active = await activeAgentCategories();
  const names = await namesOf([...agents.map((a) => a.ownerId), ...agents.flatMap((a) => a.installations.map((i) => i.userId))]);
  return agents.map((a) => {
    const approved = a.versions.find((v) => v.state === "APPROVED" && !v.faultyAt) ?? null;
    return {
      id: a.id,
      slug: a.slug,
      name: a.name,
      purpose: a.purpose,
      kind: a.kind,
      ownerName: a.ownerId ? names.get(a.ownerId) ?? null : null,
      version: approved?.version ?? null,
      draft: a.versions.find((v) => v.state === "DRAFT" || v.state === "PENDING") ?? null,
      installations: a.installations.length,
      installedBy: [...new Set(a.installations.map((i) => names.get(i.userId) ?? ""))].filter(Boolean),
      // Behind the version in use: the same rule the installations tab shows.
      updatesWaiting: approved ? a.installations.filter((i) => (a.versions.find((v) => v.id === i.pinnedVersionId)?.version ?? 0) < approved.version).length : 0,
      surfaces: [...new Set(a.installations.map((i) => i.surface))],
      lastRunFailed: a.installations.some((i) => i.runs[0]?.outcome === "FAILED"),
      categories: categoriesOf(a.categoryIds, active),
      // The agents screen's client filter (24.11.2026): the clients its
      // installations run on, and whether one of them runs on every client.
      clientIds: [...new Set(a.installations.flatMap((i) => i.clientIds))],
      allClients: a.installations.some((i) => i.clientScope === "ALL_MINE"),
    };
  });
}

export async function getAgent(actor: User, slug: string) {
  assertCan(actor.role, PROPOSE);
  const agent = await prisma.agent.findUnique({
    where: { slug },
    include: {
      versions: { orderBy: { version: "desc" } },
      installations: { where: { status: "ACTIVE" }, orderBy: { createdAt: "asc" }, include: { runs: { orderBy: { createdAt: "desc" }, take: 5 } } },
      clientValues: true,
      process: { select: { id: true, code: true, title: true, deletedAt: true, client: { select: { name: true } } } },
    },
  });
  if (!agent || agent.archivedAt) throw new DomainError("agents.notFound", "הסוכן לא נמצא.");
  const names = await namesOf([agent.ownerId, ...agent.versions.flatMap((v) => [v.createdById, v.decidedById]), ...agent.installations.map((i) => i.userId)]);
  const approved = agent.versions.find((v) => v.state === "APPROVED" && !v.faultyAt) ?? null;
  const draft = agent.versions.find((v) => v.state === "DRAFT" || v.state === "PENDING") ?? null;
  const versionNo = new Map(agent.versions.map((v) => [v.id, v.version]));
  return {
    agent: { id: agent.id, slug: agent.slug, name: agent.name, purpose: agent.purpose, kind: agent.kind, ownerId: agent.ownerId, ownerName: agent.ownerId ? names.get(agent.ownerId) ?? null : null },
    process: agent.process && !agent.process.deletedAt ? { id: agent.process.id, code: agent.process.code, title: agent.process.title, clientName: agent.process.client.name } : null,
    approved,
    draft,
    versions: agent.versions.map((v) => ({ ...v, createdByName: v.createdById ? names.get(v.createdById) ?? null : null, decidedByName: v.decidedById ? names.get(v.decidedById) ?? null : null })),
    installations: agent.installations.map((i) => ({ ...i, userName: names.get(i.userId) ?? "", pinnedVersion: versionNo.get(i.pinnedVersionId) ?? null })),
    clientValues: agent.clientValues,
    categories: categoriesOf(agent.categoryIds, await activeAgentCategories()),
    canDecide: canManageClients(actor.role),
  };
}

// --- Writing a version --------------------------------------------------------

const slugOf = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

export async function createAgent(actor: User, input: { name: string; purpose: string; kind: "CLIENT_PROJECT" | "SCHEDULED" | "SKILL"; slug?: string | null }) {
  assertCan(actor.role, PROPOSE);
  const name = input.name.trim();
  const purpose = input.purpose.trim();
  if (!name || name.length > 80) throw new DomainError("agents.nameRequired", "צריך שם לסוכן, עד 80 תווים.");
  if (!purpose || purpose.length > 300) throw new DomainError("agents.purposeRequired", "צריך לכתוב בשורה מה הסוכן עושה.");
  let slug = slugOf(input.slug?.trim() || name) || `agent-${Date.now().toString(36)}`;
  // "library" is the library screen's address under /app/agents.
  if (slug === "library") slug = "library-agent";
  if (await prisma.agent.findUnique({ where: { slug }, select: { id: true } })) slug = `${slug}-${Date.now().toString(36)}`.slice(0, 50);
  const agent = await prisma.agent.create({
    data: { slug, name, purpose, kind: input.kind, ownerId: actor.id, createdById: actor.id, versions: { create: { version: 1, createdById: actor.id } } },
  });
  await recordAudit({ actorId: actor.id, action: "agent.create", entityType: "Agent", entityId: agent.id, after: { slug, name } });
  return agent;
}

const draftInput = z.object({
  blocks: z.array(blockSchema).max(LIMITS.blocks).optional(),
  params: z.array(paramSchema).max(LIMITS.params).optional(),
  files: z.array(fileSchema).max(LIMITS.files).optional(),
  requirements: requirementsSchema.optional(),
  actionLevel: z.enum(["READ", "DRAFT", "SEND"]).optional(),
  changeNote: z.string().max(2000).nullish(),
});
export type DraftInput = z.input<typeof draftInput>;

/// The agent's one open draft, opened from the version in use when there is none.
async function openDraft(actor: User, agentId: string) {
  const existing = await prisma.agentVersion.findFirst({ where: { agentId, state: { in: ["DRAFT", "PENDING"] } } });
  if (existing?.state === "PENDING") throw new DomainError("agents.draftPending", "יש גרסה שממתינה לאישור. צריך לאשר או לדחות אותה לפני שינוי נוסף.");
  if (existing) return existing;
  const approved = await currentApproved(agentId);
  const last = await prisma.agentVersion.findFirst({ where: { agentId }, orderBy: { version: "desc" }, select: { version: true } });
  try {
    return await prisma.agentVersion.create({
      data: {
        agentId,
        version: (last?.version ?? 0) + 1,
        createdById: actor.id,
        // Client blocks live in AgentClientAddition since 24.11.2026.
        blocks: parseBlocks(approved?.blocks).filter((b) => !b.clientId) as Prisma.InputJsonValue,
        params: (approved?.params ?? []) as Prisma.InputJsonValue,
        requirements: (approved?.requirements ?? {}) as Prisma.InputJsonValue,
        files: (approved?.files ?? []) as Prisma.InputJsonValue,
        actionLevel: approved?.actionLevel ?? "READ",
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new DomainError("agents.draftRace", "מישהו אחר פתח טיוטה באותו רגע. כדאי לרענן ולנסות שוב.");
    throw err;
  }
}

export async function saveDraft(actor: User, agentId: string, raw: DraftInput) {
  assertCan(actor.role, PROPOSE);
  const parsed = draftInput.safeParse(raw);
  if (!parsed.success) throw new DomainError("agents.invalidDraft", `הטיוטה לא תקינה: ${parsed.error.issues[0]?.message ?? ""}`.trim());
  const input = parsed.data;
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { id: true, archivedAt: true } });
  if (!agent || agent.archivedAt) throw new DomainError("agents.notFound", "הסוכן לא נמצא.");
  const texts = [...(input.blocks ?? []).flatMap((b) => [b.body, b.why ?? ""]), ...(input.params ?? []).map((p) => p.default ?? ""), ...(input.files ?? []).map((f) => f.content), input.changeNote ?? ""];
  if (texts.some((t) => findSecrets(t).length > 0)) throw new DomainError("agents.hasSecret", "בטיוטה יש סיסמה, מפתח או טוקן. סודות לא נכתבים בסוכן.");
  const draft = await openDraft(actor, agentId);
  const updated = await prisma.agentVersion.update({
    where: { id: draft.id },
    data: {
      // A legacy client block copied along from the version in use stays behind:
      // its client's addition holds it now (AgentClientAddition).
      ...(input.blocks ? { blocks: input.blocks.filter((b) => !b.clientId) as Prisma.InputJsonValue } : {}),
      ...(input.params ? { params: input.params as Prisma.InputJsonValue } : {}),
      ...(input.files ? { files: input.files as Prisma.InputJsonValue } : {}),
      ...(input.requirements ? { requirements: input.requirements as Prisma.InputJsonValue } : {}),
      ...(input.actionLevel ? { actionLevel: input.actionLevel } : {}),
      ...(input.changeNote !== undefined ? { changeNote: input.changeNote?.trim() || null } : {}),
    },
  });
  await recordAudit({ actorId: actor.id, action: "agent.draft_save", entityType: "AgentVersion", entityId: updated.id, after: { version: updated.version } });
  return updated;
}

export async function draftProblems(version: AgentVersion) {
  const clientIds = new Set((await prisma.client.findMany({ where: { deletedAt: null }, select: { id: true } })).map((c) => c.id));
  return versionProblems({ ...contentOf(version), changeNote: version.changeNote, clientIds });
}

export async function submitDraft(actor: User, versionId: string) {
  assertCan(actor.role, PROPOSE);
  const v = await prisma.agentVersion.findUnique({ where: { id: versionId } });
  if (!v || v.state !== "DRAFT") throw new DomainError("agents.notDraft", "אין טיוטה פתוחה לשלוח.");
  if (!v.changeNote?.trim()) throw new DomainError("agents.changeNoteRequired", "צריך לכתוב בשורה מה השתנה ולמה. זה מה שאנשים יראו כשיציעו להם לעדכן.");
  const problems = await draftProblems(v);
  if (problems.length) throw new DomainError("agents.draftProblems", `לפני השליחה: ${problems.map((p) => p.text).join(" ")}`);
  const updated = await prisma.agentVersion.update({ where: { id: v.id }, data: { state: "PENDING", submittedAt: new Date() } });
  await recordAudit({ actorId: actor.id, action: "agent.submit", entityType: "AgentVersion", entityId: v.id, after: { version: v.version } });
  return updated;
}

export async function discardDraft(actor: User, versionId: string) {
  assertCan(actor.role, PROPOSE);
  const v = await prisma.agentVersion.findUnique({ where: { id: versionId } });
  if (!v || v.state !== "DRAFT") throw new DomainError("agents.notDraft", "אין טיוטה פתוחה לבטל.");
  const approvedCount = await prisma.agentVersion.count({ where: { agentId: v.agentId, state: "APPROVED" } });
  if (approvedCount === 0) throw new DomainError("agents.firstDraft", "זו הגרסה הראשונה של הסוכן. אפשר לערוך אותה, לא לבטל.");
  await prisma.agentVersion.delete({ where: { id: v.id } });
  await recordAudit({ actorId: actor.id, action: "agent.draft_discard", entityType: "AgentVersion", entityId: v.id, after: { version: v.version } });
}

async function pendingVersion(actor: User, versionId: string) {
  assertApprover(actor);
  const v = await prisma.agentVersion.findUnique({ where: { id: versionId } });
  if (!v) throw new DomainError("agents.versionNotFound", "הגרסה לא נמצאה.");
  if (v.state !== "PENDING") throw new DomainError("agents.alreadyDecided", "הגרסה לא ממתינה לאישור.");
  return v;
}

export async function approveVersion(actor: User, versionId: string) {
  const v = await pendingVersion(actor, versionId);
  const problems = await draftProblems(v);
  if (problems.length) throw new DomainError("agents.draftProblems", `לפני האישור: ${problems.map((p) => p.text).join(" ")}`);
  const updated = await prisma.agentVersion.update({ where: { id: v.id }, data: { state: "APPROVED", decidedById: actor.id, decidedAt: new Date() } });
  await recordAudit({ actorId: actor.id, action: "agent.approve", entityType: "AgentVersion", entityId: v.id, after: { version: v.version } });
  return updated;
}

export async function rejectVersion(actor: User, versionId: string, reason: string) {
  const v = await pendingVersion(actor, versionId);
  const why = reason.trim();
  if (!why) throw new DomainError("agents.reasonRequired", "צריך לכתוב בשורה אחת למה.");
  const updated = await prisma.agentVersion.update({ where: { id: v.id }, data: { state: "REJECTED", decidedById: actor.id, decidedAt: new Date(), rejectReason: why } });
  await recordAudit({ actorId: actor.id, action: "agent.reject", entityType: "AgentVersion", entityId: v.id, after: { version: v.version, reason: why } });
  return updated;
}

/// Takes an agent out of the library (23.11.2026). A manager's decision,
/// with a reason, and only once nobody runs it: an installation still
/// fetching would otherwise lose its instructions in the middle of a run.
/// The agent and its versions stay in the database; it just leaves every
/// list, the approvals queue and the connector.
export async function archiveAgent(actor: User, agentId: string, reason: string) {
  assertApprover(actor);
  const why = reason.trim();
  if (!why) throw new DomainError("agents.reasonRequired", "צריך לכתוב בשורה אחת למה.");
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { id: true, slug: true, archivedAt: true } });
  if (!agent || agent.archivedAt) throw new DomainError("agents.notFound", "הסוכן לא נמצא.");
  const active = await prisma.agentInstallation.count({ where: { agentId, status: "ACTIVE" } });
  if (active > 0) throw new DomainError("agents.archiveInstalled", "לסוכן יש התקנות פעילות. צריך להסיר אותן לפני שמעבירים אותו לארכיון.", { count: active });
  await prisma.agent.update({ where: { id: agentId }, data: { archivedAt: new Date() } });
  await recordAudit({ actorId: actor.id, action: "agent.archive", entityType: "Agent", entityId: agentId, after: { slug: agent.slug, reason: why } });
}

// --- The process an agent carries out (23.11.2026) ----------------------------

/// Links an agent to the Ankora process it carries out, or unlinks it
/// (null). A manager's decision: every installation gets the procedure from
/// its next fetch.
export async function setAgentProcess(actor: User, agentId: string, processId: string | null) {
  assertApprover(actor);
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { id: true, archivedAt: true, processId: true } });
  if (!agent || agent.archivedAt) throw new DomainError("agents.notFound", "הסוכן לא נמצא.");
  if (processId) {
    const process = await prisma.process.findUnique({ where: { id: processId }, select: { id: true, clientId: true, deletedAt: true } });
    if (!process || process.deletedAt) throw new DomainError("agents.processNotFound", "התהליך לא נמצא.");
    const clients = await listAccessibleClients(actor);
    if (!clients.some((c) => c.id === process.clientId)) throw new DomainError("agents.clientForbidden", "אין לך גישה ללקוח הזה.");
  }
  await prisma.agent.update({ where: { id: agentId }, data: { processId } });
  await recordAudit({ actorId: actor.id, action: "agent.process", entityType: "Agent", entityId: agentId, before: { processId: agent.processId }, after: { processId } });
}

/// The processes a manager can link, by client.
export async function linkableProcesses(actor: User) {
  const clients = (await listAccessibleClients(actor)).filter((c) => !c.aiExcluded);
  const rows = await prisma.process.findMany({ where: { clientId: { in: clients.map((c) => c.id) }, deletedAt: null, status: { not: "RETIRED" } }, orderBy: [{ clientId: "asc" }, { seq: "asc" }], select: { id: true, code: true, title: true, clientId: true } });
  const name = new Map(clients.map((c) => [c.id, c.name]));
  return rows.map((r) => ({ id: r.id, label: `${name.get(r.clientId) ?? ""} · ${r.code} ${r.title}` }));
}

/// The approved procedure of the agent's process, as the person running it
/// may see it. Null when the agent carries out no process.
export async function linkedProcedure(user: User, agentId: string): Promise<LinkedProcedure | null> {
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { process: { select: { id: true, code: true, title: true, clientId: true, deletedAt: true, client: { select: { name: true, aiExcluded: true } } } } } });
  const p = agent?.process;
  if (!p || p.deletedAt) return null;
  if (p.client.aiExcluded) return { ok: false, code: p.code, title: p.title, reason: "aiExcluded" };
  const clients = await listAccessibleClients(user);
  if (!clients.some((c) => c.id === p.clientId)) return { ok: false, code: p.code, title: p.title, reason: "noAccess" };
  const detail = await mcpGetProcess(user, p.clientId, p.id);
  if (!detail) return { ok: false, code: p.code, title: p.title, reason: "noAccess" };
  const proc = detail.procedure;
  if (!proc) return { ok: false, code: p.code, title: p.title, reason: "noApproved" };
  return {
    ok: true,
    code: p.code,
    title: p.title,
    clientName: p.client.name,
    version: proc.version,
    steps: proc.steps.map((s) => ({ n: s.n, title: s.title, output: s.output ?? null, verification: s.verification ?? null, needsApproval: !!s.needsApproval })),
    highlights: proc.highlights,
    outputs: proc.outputs,
    failsRules: proc.failsRules,
  };
}

/// The one-line description under the agent's name (23.11.2026). It is not
/// part of a version, so a manager changes it in place, with an audit entry.
export async function setAgentPurpose(actor: User, agentId: string, purpose: string) {
  assertApprover(actor);
  const text = purpose.trim();
  if (!text || text.length > 300) throw new DomainError("agents.purposeRequired", "צריך לכתוב בשורה מה הסוכן עושה.");
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { id: true, purpose: true, archivedAt: true } });
  if (!agent || agent.archivedAt) throw new DomainError("agents.notFound", "הסוכן לא נמצא.");
  if (agent.purpose === text) return;
  await prisma.agent.update({ where: { id: agentId }, data: { purpose: text } });
  await recordAudit({ actorId: actor.id, action: "agent.purpose", entityType: "Agent", entityId: agentId, before: { purpose: agent.purpose }, after: { purpose: text } });
}

// --- Client values ----------------------------------------------------------

async function assertClientAccess(actor: User, clientId: string) {
  const clients = await listAccessibleClients(actor);
  if (!clients.some((c) => c.id === clientId)) throw new DomainError("agents.clientForbidden", "אין לך גישה ללקוח הזה.");
}

export async function setClientValue(actor: User, input: { agentId: string; clientId: string; key: string; value: string }) {
  assertCan(actor.role, PROPOSE);
  await assertClientAccess(actor, input.clientId);
  const value = input.value.trim();
  if (value.length > 2000) throw new DomainError("agents.valueTooLong", "הערך ארוך מדי.");
  if (findSecrets(value).length > 0) throw new DomainError("agents.hasSecret", "בערך יש סיסמה, מפתח או טוקן. סודות לא נכתבים בסוכן.");
  const where = { agentId_clientId_key: { agentId: input.agentId, clientId: input.clientId, key: input.key } };
  if (!value) {
    await prisma.agentClientValue.deleteMany({ where: { agentId: input.agentId, clientId: input.clientId, key: input.key } });
  } else {
    await prisma.agentClientValue.upsert({ where, create: { agentId: input.agentId, clientId: input.clientId, key: input.key, value, setById: actor.id }, update: { value, setById: actor.id } });
  }
  await recordAudit({ actorId: actor.id, action: "agent.client_value", entityType: "Agent", entityId: input.agentId, after: { clientId: input.clientId, key: input.key } });
}

/// The clients a set of ids or a scope resolves to, with this agent's
/// client-level values. "בלי AI" clients never reach an agent.
export async function resolveClients(user: User, agentId: string, params: AgentParam[], scope: { clientScope: "ONE" | "LIST" | "ALL_MINE"; clientIds: string[] }): Promise<CompileClient[]> {
  const accessible = await listAccessibleClients(user);
  const allowed = scope.clientScope === "ALL_MINE" ? accessible : accessible.filter((c) => scope.clientIds.includes(c.id));
  const excluded = await aiExcludedClientIds(allowed.map((c) => c.id));
  const clients = allowed.filter((c) => !excluded.has(c.id));
  if (clients.length === 0) return [];
  const ids = clients.map((c) => c.id);
  const [values, domains] = await Promise.all([
    prisma.agentClientValue.findMany({ where: { agentId, clientId: { in: ids } } }),
    params.some((p) => p.clientField === "domains") ? prisma.clientDomain.findMany({ where: { clientId: { in: ids }, deletedAt: null }, select: { clientId: true, domain: true } }) : Promise.resolve([]),
  ]);
  return clients.map((c) => {
    const own: Record<string, string> = {};
    for (const v of values) if (v.clientId === c.id) own[v.key] = v.value;
    for (const p of params) {
      if (p.clientField === "name") own[p.key] = c.name;
      if (p.clientField === "domains") own[p.key] = domains.filter((d) => d.clientId === c.id).map((d) => d.domain).join(", ");
    }
    return { id: c.id, name: c.name, values: own };
  });
}

// --- Installations ----------------------------------------------------------

/// What an installation still needs before it is created (24.11.2026), so
/// whoever installs asks the person everything at once instead of finding
/// out on the first run. `ask` blocks the install: a required value with no
/// default, and when on a schedule. `optional` are values the person may
/// give now (or the agent finds itself). `clientGaps` are required client
/// values no one has set: a manager fills them on the agent's parameters
/// tab, and until then the run skips that client. `requirements` are what
/// the Claude account it runs in must have connected.
export async function installQuestions(
  actor: User,
  agentId: string,
  input: { surface: "PROJECT" | "SCHEDULED" | "PERSISTENT_SESSION" | "SKILL"; clientScope: "ONE" | "LIST" | "ALL_MINE"; clientIds: string[]; values?: Record<string, string>; schedules?: { cron: string; tz: string }[] }
) {
  assertCan(actor.role, PROPOSE);
  const approved = await currentApproved(agentId);
  if (!approved) throw new DomainError("agents.noApprovedVersion", "לסוכן עוד אין גרסה מאושרת להתקין.");
  const { params, requirements } = contentOf(approved);
  const given = (key: string) => !!input.values?.[key]?.trim();
  const installParams = params.filter((p) => p.level === "INSTALLATION" && !p.default && !given(p.key));
  const ask: { key: string; label: string; type: string }[] = [];
  if (input.clientScope !== "ALL_MINE" && input.clientIds.length === 0) ask.push({ key: "clients", label: "Which clients it works on (or all of them)", type: "CLIENTS" });
  if (input.surface === "SCHEDULED" && (input.schedules ?? []).length === 0) ask.push({ key: "schedule", label: "When it runs: a cron and a time zone, e.g. 0 8 * * 0-4 Asia/Jerusalem", type: "SCHEDULE" });
  for (const p of installParams.filter((p) => p.required)) ask.push({ key: p.key, label: p.label, type: p.type });
  const optional = installParams.filter((p) => !p.required).map((p) => ({ key: p.key, label: p.label, type: p.type }));
  const clients = input.clientScope !== "ALL_MINE" && input.clientIds.length === 0 ? [] : await resolveClients(actor, agentId, params, input);
  const clientParams = params.filter((p) => p.level === "CLIENT" && p.required && !p.default);
  const clientGaps = clients
    .map((c) => ({ client: c.name, missing: clientParams.filter((p) => !c.values[p.key]?.trim()).map((p) => p.label) }))
    .filter((g) => g.missing.length > 0);
  return {
    ask,
    optional,
    clientGaps,
    requirements: { connectors: requirements.connectors, skills: requirements.skills.map((s) => skillOf(s).slug), repos: requirements.repos, localMcp: requirements.localMcp, externalRunners: requirements.externalRunners, notes: requirements.notes ?? null },
  };
}


const scheduleSchema = z.object({ cron: z.string().trim().min(9).max(120), tz: z.string().trim().min(3).max(60) });

export async function createInstallation(
  actor: User,
  input: {
    agentId: string;
    surface: "PROJECT" | "SCHEDULED" | "PERSISTENT_SESSION" | "SKILL";
    clientScope: "ONE" | "LIST" | "ALL_MINE";
    clientIds: string[];
    checkEvery: "RUN" | "DAILY" | "WEEKLY";
    claudeAccount?: string | null;
    values?: Record<string, string>;
    schedules?: { cron: string; tz: string }[];
  }
) {
  assertCan(actor.role, PROPOSE);
  const approved = await currentApproved(input.agentId);
  if (!approved) throw new DomainError("agents.noApprovedVersion", "לסוכן עוד אין גרסה מאושרת להתקין.");
  if (input.clientScope !== "ALL_MINE") {
    if (input.clientIds.length === 0) throw new DomainError("agents.clientsRequired", "צריך לבחור לפחות לקוח אחד.");
    if (input.clientScope === "ONE" && input.clientIds.length > 1) throw new DomainError("agents.oneClient", "בהתקנה ללקוח אחד בוחרים לקוח אחד.");
    for (const id of input.clientIds) await assertClientAccess(actor, id);
  }
  const schedules = z.array(scheduleSchema).max(10).safeParse(input.schedules ?? []);
  if (!schedules.success) throw new DomainError("agents.scheduleTz", "לכל תזמון צריך cron ואזור זמן, למשל Asia/Jerusalem.");
  const values: Record<string, string> = Object.fromEntries(Object.entries(input.values ?? {}).map(([k, v]) => [k, String(v).trim()] as const).filter(([, v]) => v));
  if (Object.values(values).some((v) => findSecrets(v).length > 0)) throw new DomainError("agents.hasSecret", "בערך יש סיסמה, מפתח או טוקן. סודות לא נכתבים בסוכן.");
  const row = await prisma.agentInstallation.create({
    data: {
      agentId: input.agentId,
      userId: actor.id,
      surface: input.surface,
      claudeAccount: input.claudeAccount?.trim() || null,
      clientScope: input.clientScope,
      clientIds: input.clientScope === "ALL_MINE" ? [] : input.clientIds,
      checkEvery: input.checkEvery,
      values,
      schedules: schedules.data,
      pinnedVersionId: approved.id,
    },
  });
  await recordAudit({ actorId: actor.id, action: "agent.install", entityType: "AgentInstallation", entityId: row.id, after: { agentId: input.agentId, version: approved.version, surface: input.surface } });
  return row;
}

async function ownInstallation(actor: User, installationId: string) {
  const inst = await prisma.agentInstallation.findUnique({ where: { id: installationId }, include: { agent: true } });
  if (!inst || inst.status !== "ACTIVE" || inst.agent.archivedAt) throw new DomainError("agents.installationNotFound", "ההתקנה לא נמצאה או שהוסרה.");
  if (inst.userId !== actor.id && !canManageClients(actor.role)) throw new DomainError("agents.installationNotYours", "ההתקנה הזו שייכת למישהו אחר.");
  return inst;
}

export async function removeInstallation(actor: User, installationId: string) {
  const inst = await ownInstallation(actor, installationId);
  await prisma.agentInstallation.update({ where: { id: inst.id }, data: { status: "REMOVED" } });
  await recordAudit({ actorId: actor.id, action: "agent.uninstall", entityType: "AgentInstallation", entityId: inst.id });
}

async function compileVersion(user: User, inst: { id: string; agentId: string; values: Prisma.JsonValue; clientScope: "ONE" | "LIST" | "ALL_MINE"; clientIds: string[] }, agent: { name: string; slug: string; purpose: string }, v: AgentVersion) {
  const content = contentOf(v);
  const clients = await resolveClients(user, inst.agentId, content.params, inst);
  const values = (inst.values && typeof inst.values === "object" && !Array.isArray(inst.values) ? inst.values : {}) as Record<string, string>;
  return compileAgent({ agent, version: { version: v.version, ...content }, installation: { id: inst.id, values, userName: user.name }, clients, library: await approvedLibrary(), additions: await approvedAdditions(inst.agentId, clients.map((c) => c.id)), locale: user.locale });
}

/// What get_agent returns: the instructions of the pinned version, and an
/// update when one is due for this installation.
export async function fetchAgent(actor: User, installationId: string, now = new Date()) {
  const inst = await ownInstallation(actor, installationId);
  if (inst.userId !== actor.id) throw new DomainError("agents.installationNotYours", "ההתקנה הזו שייכת למישהו אחר.");
  let pinned = await prisma.agentVersion.findUniqueOrThrow({ where: { id: inst.pinnedVersionId } });
  const latest = await currentApproved(inst.agentId);
  // Phase 2: a version marked faulty is left at once, without asking.
  let fellBackFrom: { version: number; reason: string | null } | null = null;
  if (pinned.faultyAt && latest) {
    fellBackFrom = { version: pinned.version, reason: pinned.faultyReason };
    pinned = latest;
  }
  const due = isCheckDue(inst.checkEvery, inst.lastCheckedAt, now);
  let compiled = await compileVersion(actor, inst, inst.agent, pinned);
  let update: null | { version: number; notes: { version: number; note: string }[]; ask: boolean } = null;
  let pendingVersion = fellBackFrom ? null : inst.pendingVersion;

  if (latest && latest.version > pinned.version && due) {
    const next = await compileVersion(actor, inst, inst.agent, latest);
    if (next.body === compiled.body) {
      // Nothing changes for this installation: take it without asking.
      pinned = latest;
      compiled = next;
      pendingVersion = null;
    } else {
      const between = await prisma.agentVersion.findMany({ where: { agentId: inst.agentId, state: "APPROVED", faultyAt: null, version: { gt: pinned.version, lte: latest.version } }, orderBy: { version: "asc" }, select: { version: true, changeNote: true } });
      const ask = inst.surface === "PROJECT" || inst.surface === "SKILL";
      update = { version: latest.version, notes: between.map((b) => ({ version: b.version, note: b.changeNote ?? "" })), ask };
      pendingVersion = latest.version;
      if (!ask && inst.pendingVersion !== latest.version) await notifyOwner(inst.userId, inst.agent.slug, "agent.update_waiting", (t) => ({ title: t("agents.updateWaitingTitle", { agent: inst.agent.name, version: latest.version }), body: t("agents.updateWaitingBody") }));
    }
  }
  await prisma.agentInstallation.update({
    where: { id: inst.id },
    data: { lastFetchedAt: now, ...(due ? { lastCheckedAt: now } : {}), pinnedVersionId: pinned.id, pendingVersion },
  });
  return { installation: inst, agent: inst.agent, version: pinned.version, compiled, update, fellBackFrom };
}

/// What get_agent_file returns: one attached file of the version this
/// installation runs (the same version get_agent just compiled).
export async function agentFile(actor: User, installationId: string, path: string) {
  const inst = await ownInstallation(actor, installationId);
  if (inst.userId !== actor.id) throw new DomainError("agents.installationNotYours", "ההתקנה הזו שייכת למישהו אחר.");
  let pinned = await prisma.agentVersion.findUniqueOrThrow({ where: { id: inst.pinnedVersionId } });
  if (pinned.faultyAt) pinned = (await currentApproved(inst.agentId)) ?? pinned;
  const files = parseFiles(pinned.files);
  const file = files.find((f) => f.path === path.trim());
  if (!file) {
    const list = files.map((f) => f.path).join(", ") || "אין";
    throw new DomainError("agents.fileNotFound", `אין קובץ כזה בגרסה של ההתקנה. הקבצים: ${list}.`, { files: list });
  }
  return { path: file.path, content: file.content, version: pinned.version };
}

// ADR 0006: a bell row is worded in its recipient's language when it is created.
async function notifyOwner(userId: string, slug: string, type: string, words: (t: OutgoingT) => { title: string; body: string }) {
  const { t } = await outgoingForUser(userId);
  const { title, body } = words(t);
  await prisma.notification.create({ data: { userId, type, title: title.slice(0, 200), body, entityType: "Agent", entityId: slug } });
}

// --- Phase 2: runs, faulty versions, the agent's own values --------------------

const RUN_TEXT = 500;

/// One run, as the agent reports it. A failed run tells the installation's
/// owner, at most once in 12 hours for the same installation.
export async function recordRun(
  actor: User,
  installationId: string,
  input: { outcome: "OK" | "PARTIAL" | "FAILED"; summary: string; problems?: string[]; missing?: string[]; startedAt?: Date | null }
) {
  const inst = await ownInstallation(actor, installationId);
  if (inst.userId !== actor.id) throw new DomainError("agents.installationNotYours", "ההתקנה הזו שייכת למישהו אחר.");
  const summary = input.summary.trim().slice(0, RUN_TEXT);
  if (!summary) throw new DomainError("agents.runSummaryRequired", "צריך שורה אחת על מה שהריצה עשתה.");
  const clean = (xs?: string[]) => (xs ?? []).map((x) => x.trim().slice(0, RUN_TEXT)).filter(Boolean).slice(0, 20);
  const texts = [summary, ...clean(input.problems), ...clean(input.missing)];
  if (texts.some((t) => findSecrets(t).length > 0)) throw new DomainError("agents.hasSecret", "בדיווח יש סיסמה, מפתח או טוקן. סודות לא נכתבים בסוכן.");
  const pinned = await prisma.agentVersion.findUniqueOrThrow({ where: { id: inst.pinnedVersionId }, select: { version: true } });
  const run = await prisma.agentRun.create({
    data: { installationId: inst.id, version: pinned.version, outcome: input.outcome, summary, problems: clean(input.problems), missing: clean(input.missing), startedAt: input.startedAt ?? null },
  });
  if (input.outcome === "FAILED" || clean(input.missing).length > 0) {
    const since = new Date(Date.now() - 12 * 60 * 60 * 1000);
    const recent = await prisma.notification.count({ where: { userId: inst.userId, type: "agent.run_failed", entityId: inst.agent.slug, createdAt: { gte: since } } });
    if (recent === 0) {
      await notifyOwner(inst.userId, inst.agent.slug, "agent.run_failed", (t) => {
        const why = [...clean(input.missing).map((m) => t("agents.missing", { item: m })), ...clean(input.problems)].slice(0, 3).join(" · ");
        return { title: t(input.outcome === "FAILED" ? "agents.runFailedTitle" : "agents.runMissingTitle", { agent: inst.agent.name }), body: why || summary };
      });
    }
  }
  return run;
}

export async function markFaulty(actor: User, versionId: string, reason: string) {
  assertApprover(actor);
  const v = await prisma.agentVersion.findUnique({ where: { id: versionId } });
  if (!v || v.state !== "APPROVED") throw new DomainError("agents.versionNotApproved", `גרסה ${v?.version ?? ""} לא מאושרת.`, { version: v?.version ?? "" });
  if (v.faultyAt) throw new DomainError("agents.alreadyFaulty", "הגרסה כבר סומנה כתקולה.");
  const why = reason.trim();
  if (!why) throw new DomainError("agents.reasonRequired", "צריך לכתוב בשורה אחת למה.");
  const fallback = await prisma.agentVersion.findFirst({ where: { agentId: v.agentId, state: "APPROVED", faultyAt: null, id: { not: v.id } }, orderBy: { version: "desc" } });
  if (!fallback) throw new DomainError("agents.noFallback", "אין גרסה מאושרת אחרת לחזור אליה. צריך לאשר גרסה מתוקנת קודם.");
  await prisma.agentVersion.update({ where: { id: v.id }, data: { faultyAt: new Date(), faultyById: actor.id, faultyReason: why } });
  // Every installation on it moves now, so even one that is not checking
  // for updates today runs the version before it on its next run.
  await prisma.agentInstallation.updateMany({ where: { pinnedVersionId: v.id }, data: { pinnedVersionId: fallback.id, pendingVersion: null } });
  await recordAudit({ actorId: actor.id, action: "agent.mark_faulty", entityType: "AgentVersion", entityId: v.id, after: { version: v.version, fallback: fallback.version, reason: why } });
  return fallback;
}

/// "החזר לגרסה 5" (23.11.2026): opens a draft that is a copy of an earlier
/// approved version, so the history stays one line read top to bottom.
/// The copy goes through the normal approval like any other draft.
export async function revertToVersion(actor: User, agentId: string, version: number) {
  assertCan(actor.role, PROPOSE);
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { id: true, archivedAt: true } });
  if (!agent || agent.archivedAt) throw new DomainError("agents.notFound", "הסוכן לא נמצא.");
  const target = await prisma.agentVersion.findUnique({ where: { agentId_version: { agentId, version } } });
  if (!target || target.state !== "APPROVED") throw new DomainError("agents.versionNotApproved", `גרסה ${version} לא מאושרת.`, { version });
  if (target.faultyAt) throw new DomainError("agents.revertFaulty", `גרסה ${version} סומנה כתקולה. אי אפשר לחזור אליה.`, { version });
  const current = await currentApproved(agentId);
  if (current?.id === target.id) throw new DomainError("agents.revertCurrent", `גרסה ${version} היא הגרסה שבשימוש.`, { version });
  const open = await prisma.agentVersion.findFirst({ where: { agentId, state: { in: ["DRAFT", "PENDING"] } }, select: { state: true } });
  if (open?.state === "PENDING") throw new DomainError("agents.draftPending", "יש גרסה שממתינה לאישור. צריך לאשר או לדחות אותה לפני שינוי נוסף.");
  if (open) throw new DomainError("agents.revertDraftOpen", "יש טיוטה פתוחה. צריך לשלוח אותה או לבטל אותה לפני שחוזרים לגרסה קודמת.");
  const last = await prisma.agentVersion.findFirst({ where: { agentId }, orderBy: { version: "desc" }, select: { version: true } });
  let draft;
  try {
    draft = await prisma.agentVersion.create({
      data: {
        agentId,
        version: (last?.version ?? 0) + 1,
        createdById: actor.id,
        // Client blocks of an old version stay behind: they live in AgentClientAddition.
        blocks: parseBlocks(target.blocks).filter((b) => !b.clientId) as Prisma.InputJsonValue,
        params: target.params as Prisma.InputJsonValue,
        requirements: target.requirements as Prisma.InputJsonValue,
        files: target.files as Prisma.InputJsonValue,
        actionLevel: target.actionLevel,
        changeNote: `חזרה לגרסה ${version}`,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new DomainError("agents.draftRace", "מישהו אחר פתח טיוטה באותו רגע. כדאי לרענן ולנסות שוב.");
    throw err;
  }
  await recordAudit({ actorId: actor.id, action: "agent.revert", entityType: "AgentVersion", entityId: draft.id, after: { version: draft.version, from: version } });
  return draft;
}

/// The agent fills an installation-level value it found itself (a label id).
export async function setInstallationValue(actor: User, installationId: string, key: string, value: string) {
  const inst = await ownInstallation(actor, installationId);
  if (inst.userId !== actor.id) throw new DomainError("agents.installationNotYours", "ההתקנה הזו שייכת למישהו אחר.");
  const pinned = await prisma.agentVersion.findUniqueOrThrow({ where: { id: inst.pinnedVersionId } });
  const param = contentOf(pinned).params.find((p) => p.key === key);
  if (!param || param.level !== "INSTALLATION") throw new DomainError("agents.notInstallationParam", `"${key}" הוא לא פרמטר ברמת התקנה בסוכן הזה.`, { key });
  const v = value.trim();
  if (v.length > 2000) throw new DomainError("agents.valueTooLong", "הערך ארוך מדי.");
  if (findSecrets(v).length > 0) throw new DomainError("agents.hasSecret", "בערך יש סיסמה, מפתח או טוקן. סודות לא נכתבים בסוכן.");
  const values = { ...((inst.values ?? {}) as Record<string, string>) };
  if (v) values[key] = v;
  else delete values[key];
  await prisma.agentInstallation.update({ where: { id: inst.id }, data: { values } });
  await recordAudit({ actorId: actor.id, action: "agent.installation_value", entityType: "AgentInstallation", entityId: inst.id, after: { key } });
}

/// The installations of this person, for list_my_agents.
export async function listMyInstallations(actor: User) {
  const rows = await prisma.agentInstallation.findMany({
    where: { userId: actor.id, status: "ACTIVE", agent: { archivedAt: null } },
    include: { agent: { select: { slug: true, name: true, purpose: true } }, runs: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: { createdAt: "asc" },
  });
  const versionNo = new Map((await prisma.agentVersion.findMany({ where: { id: { in: rows.map((r) => r.pinnedVersionId) } }, select: { id: true, version: true } })).map((v) => [v.id, v.version]));
  const latest = new Map<string, number>();
  for (const r of rows) {
    if (!latest.has(r.agentId)) latest.set(r.agentId, (await currentApproved(r.agentId))?.version ?? 0);
  }
  return rows.map((r) => ({
    installation: r.id,
    agent: r.agent,
    surface: r.surface,
    version: versionNo.get(r.pinnedVersionId) ?? null,
    latestVersion: latest.get(r.agentId) ?? null,
    lastFetchedAt: r.lastFetchedAt,
    lastRun: r.runs[0] ? { outcome: r.runs[0].outcome, summary: r.runs[0].summary, at: r.runs[0].createdAt } : null,
  }));
}

export async function acceptUpdate(actor: User, installationId: string, version: number) {
  const inst = await ownInstallation(actor, installationId);
  const target = await prisma.agentVersion.findUnique({ where: { agentId_version: { agentId: inst.agentId, version } } });
  if (!target || target.state !== "APPROVED") throw new DomainError("agents.versionNotApproved", `גרסה ${version} לא מאושרת.`, { version });
  const latest = await currentApproved(inst.agentId);
  if (latest && target.version !== latest.version) throw new DomainError("agents.notLatest", `הגרסה העדכנית היא ${latest.version}.`, { version: latest.version });
  await prisma.agentInstallation.update({ where: { id: inst.id }, data: { pinnedVersionId: target.id, pendingVersion: null } });
  await recordAudit({ actorId: actor.id, action: "agent.update_accept", entityType: "AgentInstallation", entityId: inst.id, after: { version } });
  return target;
}

/// The full context of one client for this installation's agent.
export async function clientContext(actor: User, installationId: string, clientName: string) {
  const inst = await ownInstallation(actor, installationId);
  const pinned = await prisma.agentVersion.findUniqueOrThrow({ where: { id: inst.pinnedVersionId } });
  const content = contentOf(pinned);
  const clients = await resolveClients(actor, inst.agentId, content.params, inst);
  const needle = clientName.trim().toLowerCase();
  const client = clients.find((c) => c.name.toLowerCase() === needle) ?? clients.find((c) => c.name.toLowerCase().includes(needle));
  if (!client) throw new DomainError("agents.clientNotInScope", "הלקוח לא בהתקנה הזו, או שהוא מסומן \"בלי AI\".");
  // The headings follow the installation owner's language, as get_agent does.
  const owner = inst.userId === actor.id ? actor : await prisma.user.findUniqueOrThrow({ where: { id: inst.userId }, select: { locale: true } });
  const one = compileAgent({ agent: inst.agent, version: { version: pinned.version, ...content }, installation: null, clients: [client], library: await approvedLibrary(), additions: await approvedAdditions(inst.agentId, [client.id]), locale: owner.locale });
  return { client, compiled: one };
}

// --- Approvals screen -------------------------------------------------------

export async function pendingAgentVersions() {
  return prisma.agentVersion.findMany({ where: { state: "PENDING", agent: { archivedAt: null } }, orderBy: { submittedAt: "asc" }, include: { agent: { select: { slug: true, name: true } } } });
}
