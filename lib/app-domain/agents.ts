import "server-only";
import { prisma } from "@/lib/prisma";
import { Prisma, type AgentVersion, type User } from "@prisma/client";
import { assertCan, canManageClients, ForbiddenError } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { findSecrets } from "@/lib/secret-scan";
import { DomainError } from "@/lib/domain-error";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { aiExcludedClientIds } from "@/lib/app-domain/ai-exclusion-db";
import { LIMITS, parseBlocks, parseParams, parseRequirements, requirementsSchema, versionProblems, blockSchema, paramSchema, type AgentBlock, type AgentParam, type AgentRequirements } from "@/lib/agents/model";
import { compileAgent, isCheckDue, type CompileClient } from "@/lib/agents/compile";
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

export type VersionContent = { blocks: AgentBlock[]; params: AgentParam[]; requirements: AgentRequirements; actionLevel: AgentVersion["actionLevel"] };

export function contentOf(v: Pick<AgentVersion, "blocks" | "params" | "requirements" | "actionLevel">): VersionContent {
  return { blocks: parseBlocks(v.blocks), params: parseParams(v.params), requirements: parseRequirements(v.requirements), actionLevel: v.actionLevel };
}

async function currentApproved(agentId: string) {
  return prisma.agentVersion.findFirst({ where: { agentId, state: "APPROVED" }, orderBy: { version: "desc" } });
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
      versions: { select: { id: true, version: true, state: true }, orderBy: { version: "desc" } },
      installations: { where: { status: "ACTIVE" }, select: { id: true, userId: true, surface: true, pinnedVersionId: true } },
    },
  });
  const names = await namesOf([...agents.map((a) => a.ownerId), ...agents.flatMap((a) => a.installations.map((i) => i.userId))]);
  return agents.map((a) => {
    const approved = a.versions.find((v) => v.state === "APPROVED") ?? null;
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
    };
  });
}

export async function getAgent(actor: User, slug: string) {
  assertCan(actor.role, PROPOSE);
  const agent = await prisma.agent.findUnique({
    where: { slug },
    include: {
      versions: { orderBy: { version: "desc" } },
      installations: { where: { status: "ACTIVE" }, orderBy: { createdAt: "asc" } },
      clientValues: true,
    },
  });
  if (!agent || agent.archivedAt) throw new DomainError("agents.notFound", "הסוכן לא נמצא.");
  const names = await namesOf([agent.ownerId, ...agent.versions.flatMap((v) => [v.createdById, v.decidedById]), ...agent.installations.map((i) => i.userId)]);
  const approved = agent.versions.find((v) => v.state === "APPROVED") ?? null;
  const draft = agent.versions.find((v) => v.state === "DRAFT" || v.state === "PENDING") ?? null;
  const versionNo = new Map(agent.versions.map((v) => [v.id, v.version]));
  return {
    agent: { id: agent.id, slug: agent.slug, name: agent.name, purpose: agent.purpose, kind: agent.kind, ownerId: agent.ownerId, ownerName: agent.ownerId ? names.get(agent.ownerId) ?? null : null },
    approved,
    draft,
    versions: agent.versions.map((v) => ({ ...v, createdByName: v.createdById ? names.get(v.createdById) ?? null : null, decidedByName: v.decidedById ? names.get(v.decidedById) ?? null : null })),
    installations: agent.installations.map((i) => ({ ...i, userName: names.get(i.userId) ?? "", pinnedVersion: versionNo.get(i.pinnedVersionId) ?? null })),
    clientValues: agent.clientValues,
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
        blocks: (approved?.blocks ?? []) as Prisma.InputJsonValue,
        params: (approved?.params ?? []) as Prisma.InputJsonValue,
        requirements: (approved?.requirements ?? {}) as Prisma.InputJsonValue,
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
  const texts = [...(input.blocks ?? []).flatMap((b) => [b.body, b.why ?? ""]), ...(input.params ?? []).map((p) => p.default ?? ""), input.changeNote ?? ""];
  if (texts.some((t) => findSecrets(t).length > 0)) throw new DomainError("agents.hasSecret", "בטיוטה יש סיסמה, מפתח או טוקן. סודות לא נכתבים בסוכן.");
  const draft = await openDraft(actor, agentId);
  const updated = await prisma.agentVersion.update({
    where: { id: draft.id },
    data: {
      ...(input.blocks ? { blocks: input.blocks as Prisma.InputJsonValue } : {}),
      ...(input.params ? { params: input.params as Prisma.InputJsonValue } : {}),
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
  return compileAgent({ agent, version: { version: v.version, ...content }, installation: { id: inst.id, values, userName: user.name }, clients });
}

/// What get_agent returns: the instructions of the pinned version, and an
/// update when one is due for this installation.
export async function fetchAgent(actor: User, installationId: string, now = new Date()) {
  const inst = await ownInstallation(actor, installationId);
  if (inst.userId !== actor.id) throw new DomainError("agents.installationNotYours", "ההתקנה הזו שייכת למישהו אחר.");
  let pinned = await prisma.agentVersion.findUniqueOrThrow({ where: { id: inst.pinnedVersionId } });
  const latest = await currentApproved(inst.agentId);
  const due = isCheckDue(inst.checkEvery, inst.lastCheckedAt, now);
  let compiled = await compileVersion(actor, inst, inst.agent, pinned);
  let update: null | { version: number; notes: { version: number; note: string }[]; ask: boolean } = null;
  let pendingVersion = inst.pendingVersion;

  if (latest && latest.version > pinned.version && due) {
    const next = await compileVersion(actor, inst, inst.agent, latest);
    if (next.body === compiled.body) {
      // Nothing changes for this installation: take it without asking.
      pinned = latest;
      compiled = next;
      pendingVersion = null;
    } else {
      const between = await prisma.agentVersion.findMany({ where: { agentId: inst.agentId, state: "APPROVED", version: { gt: pinned.version, lte: latest.version } }, orderBy: { version: "asc" }, select: { version: true, changeNote: true } });
      const ask = inst.surface === "PROJECT" || inst.surface === "SKILL";
      update = { version: latest.version, notes: between.map((b) => ({ version: b.version, note: b.changeNote ?? "" })), ask };
      pendingVersion = latest.version;
    }
  }
  await prisma.agentInstallation.update({
    where: { id: inst.id },
    data: { lastFetchedAt: now, ...(due ? { lastCheckedAt: now } : {}), pinnedVersionId: pinned.id, pendingVersion },
  });
  return { installation: inst, agent: inst.agent, version: pinned.version, compiled, update };
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
  const one = compileAgent({ agent: inst.agent, version: { version: pinned.version, ...content }, installation: null, clients: [client] });
  return { client, compiled: one };
}

// --- Approvals screen -------------------------------------------------------

export async function pendingAgentVersions() {
  return prisma.agentVersion.findMany({ where: { state: "PENDING" }, orderBy: { submittedAt: "asc" }, include: { agent: { select: { slug: true, name: true } } } });
}
