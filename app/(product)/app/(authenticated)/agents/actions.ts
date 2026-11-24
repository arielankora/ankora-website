"use server";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { domainErrorText } from "@/lib/i18n/domain-errors";
import { prisma } from "@/lib/prisma";
import {
  acceptUpdate,
  approveVersion,
  archiveAgent,
  setAgentPurpose,
  setAgentSlug,
  contentOf,
  createAgent,
  createInstallation,
  discardDraft,
  markFaulty,
  rejectVersion,
  removeInstallation,
  revertToVersion,
  saveDraft,
  setAgentProcess,
  setClientValue,
  submitDraft,
} from "@/lib/app-domain/agents";
import { BLOCK_KINDS, CLIENT_FIELDS, PARAM_LEVELS, PARAM_TYPES, parseSkillText, type AgentBlock, type AgentParam } from "@/lib/agents/model";
import { bootstrapText } from "@/lib/agents/compile";
import { approveClientAddition, discardClientAddition, isClientAddition, rejectClientAddition, saveClientAddition, submitClientAddition } from "@/lib/app-domain/agent-client-additions";
import { parseBlocks } from "@/lib/agents/model";
import { createAgentCategory, moveAgentCategory, renameAgentCategory, setAgentCategories, setAgentCategoryArchived } from "@/lib/app-domain/agent-categories";
import { approveSharedVersion, decideLesson, proposeSharedBlock, rejectSharedVersion, sharedBlockForAgent } from "@/lib/app-domain/agent-library";

// Agents, phase 1: the screens' writes. Every one goes through
// lib/app-domain/agents.ts, the same functions the MCP tools call.

type FormState = { error?: string; ok?: boolean; slug?: string; bootstrap?: string; version?: number };

async function friendlyError(err: unknown): Promise<string> {
  const t = await getTranslations("agents.errors");
  if (err instanceof ForbiddenError) return t("forbidden");
  const domain = await domainErrorText(err);
  if (domain) return domain;
  if (err instanceof Error) return err.message;
  return t("generic");
}

async function run(fn: () => Promise<FormState | void>): Promise<FormState> {
  let out: FormState | void;
  try {
    out = await fn();
  } catch (err) {
    return { error: await friendlyError(err) };
  }
  revalidatePath("/app/agents", "layout");
  return { ok: true, ...(out ?? {}) };
}

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const list = (f: FormData, k: string) => str(f, k).split(/[,\n]/).map((s) => s.trim()).filter(Boolean);

/// The draft's content when there is one, else the version in use: what an edit starts from.
async function editable(agentId: string) {
  const v = await prisma.agentVersion.findFirst({ where: { agentId, state: { in: ["DRAFT", "APPROVED"] } }, orderBy: [{ version: "desc" }] });
  return v ? contentOf(v) : { blocks: [], params: [], requirements: undefined, actionLevel: "READ" as const };
}

export async function createAgentAction(_prev: FormState | undefined, f: FormData): Promise<FormState> {
  const user = await requireUser();
  return run(async () => {
    const kind = str(f, "kind");
    const agent = await createAgent(user, { name: str(f, "name"), purpose: str(f, "purpose"), kind: (["CLIENT_PROJECT", "SCHEDULED", "SKILL"].includes(kind) ? kind : "SCHEDULED") as "CLIENT_PROJECT" | "SCHEDULED" | "SKILL" });
    return { slug: agent.slug };
  });
}

export async function saveBlockAction(_prev: FormState | undefined, f: FormData): Promise<FormState> {
  const user = await requireUser();
  return run(async () => {
    const agentId = str(f, "agentId");
    const original = str(f, "originalKey");
    const kind = str(f, "kind") as AgentBlock["kind"];
    const title = str(f, "title");
    const block: AgentBlock = {
      key: str(f, "key") || original || `b${Date.now().toString(36)}`,
      kind: BLOCK_KINDS.includes(kind) ? kind : "rules",
      title,
      body: String(f.get("body") ?? "").trim(),
      why: str(f, "why") || null,
      safety: f.get("safety") === "on",
      overridable: f.get("overridable") === "on" && f.get("safety") !== "on",
    };
    const { blocks } = await editable(agentId);
    const next = original ? blocks.map((b) => (b.key === original ? block : b)) : [...blocks, block];
    await saveDraft(user, agentId, { blocks: next });
  });
}

export async function deleteBlockAction(agentId: string, key: string): Promise<FormState> {
  const user = await requireUser();
  return run(async () => {
    const { blocks } = await editable(agentId);
    await saveDraft(user, agentId, { blocks: blocks.filter((b) => b.key !== key) });
  });
}

export async function saveParamAction(_prev: FormState | undefined, f: FormData): Promise<FormState> {
  const user = await requireUser();
  return run(async () => {
    const agentId = str(f, "agentId");
    const original = str(f, "originalKey");
    const level = str(f, "level") as AgentParam["level"];
    const type = str(f, "type") as AgentParam["type"];
    const clientField = str(f, "clientField") as NonNullable<AgentParam["clientField"]>;
    const param: AgentParam = {
      key: str(f, "key"),
      label: str(f, "label"),
      level: PARAM_LEVELS.includes(level) ? level : "AGENT",
      type: PARAM_TYPES.includes(type) ? type : "TEXT",
      required: f.get("required") === "on",
      default: str(f, "default") || null,
      clientField: CLIENT_FIELDS.includes(clientField) ? clientField : null,
    };
    const { params } = await editable(agentId);
    const next = original ? params.map((p) => (p.key === original ? param : p)) : [...params, param];
    await saveDraft(user, agentId, { params: next });
  });
}

export async function deleteParamAction(agentId: string, key: string): Promise<FormState> {
  const user = await requireUser();
  return run(async () => {
    const { params } = await editable(agentId);
    await saveDraft(user, agentId, { params: params.filter((p) => p.key !== key) });
  });
}

export async function saveMetaAction(_prev: FormState | undefined, f: FormData): Promise<FormState> {
  const user = await requireUser();
  return run(async () => {
    const level = str(f, "actionLevel");
    await saveDraft(user, str(f, "agentId"), {
      actionLevel: (["READ", "DRAFT", "SEND"].includes(level) ? level : "READ") as "READ" | "DRAFT" | "SEND",
      changeNote: str(f, "changeNote") || null,
      requirements: { connectors: list(f, "connectors"), skills: list(f, "skills").map(parseSkillText), repos: list(f, "repos"), localMcp: list(f, "localMcp"), externalRunners: list(f, "externalRunners"), model: str(f, "model") || null, notes: str(f, "notes") || null },
    });
  });
}

export async function submitDraftAction(versionId: string): Promise<FormState> {
  const user = await requireUser();
  return run(() => submitDraft(user, versionId).then(() => undefined));
}

export async function discardDraftAction(versionId: string): Promise<FormState> {
  const user = await requireUser();
  return run(() => discardDraft(user, versionId));
}

// An agent version or a client addition's version: the id says which.
export async function approveVersionAction(versionId: string): Promise<FormState> {
  const user = await requireUser();
  return run(async () => {
    if (await isClientAddition(versionId)) await approveClientAddition(user, versionId);
    else await approveVersion(user, versionId);
  });
}

export async function rejectVersionAction(_prev: FormState | undefined, f: FormData): Promise<FormState> {
  const user = await requireUser();
  return run(async () => {
    const id = str(f, "id");
    if (await isClientAddition(id)) await rejectClientAddition(user, id, str(f, "reason"));
    else await rejectVersion(user, id, str(f, "reason"));
  });
}

// --- Client additions (24.11.2026) -------------------------------------------

/// The addition's open draft when there is one, else its version in use.
async function editableAddition(agentId: string, clientId: string) {
  const row = await prisma.agentClientAddition.findFirst({ where: { agentId, clientId, state: { in: ["DRAFT", "APPROVED"] } }, orderBy: { version: "desc" } });
  return parseBlocks(row?.blocks);
}

export async function saveAdditionBlockAction(_prev: FormState | undefined, f: FormData): Promise<FormState> {
  const user = await requireUser();
  return run(async () => {
    const agentId = str(f, "agentId");
    const clientId = str(f, "clientId");
    const original = str(f, "originalKey");
    const kind = str(f, "kind") as AgentBlock["kind"];
    const block: AgentBlock = {
      key: original || `c${Date.now().toString(36)}`,
      kind: BLOCK_KINDS.includes(kind) ? kind : "rules",
      title: str(f, "title"),
      body: String(f.get("body") ?? "").trim(),
      why: str(f, "why") || null,
      replaces: str(f, "replaces") || null,
    };
    const blocks = await editableAddition(agentId, clientId);
    const next = original ? blocks.map((b) => (b.key === original ? block : b)) : [...blocks, block];
    await saveClientAddition(user, { agentId, clientId, blocks: next });
  });
}

export async function deleteAdditionBlockAction(agentId: string, clientId: string, key: string): Promise<FormState> {
  const user = await requireUser();
  return run(async () => {
    const blocks = await editableAddition(agentId, clientId);
    await saveClientAddition(user, { agentId, clientId, blocks: blocks.filter((b) => b.key !== key) });
  });
}

export async function saveAdditionNoteAction(_prev: FormState | undefined, f: FormData): Promise<FormState> {
  const user = await requireUser();
  return run(() => saveClientAddition(user, { agentId: str(f, "agentId"), clientId: str(f, "clientId"), changeNote: str(f, "changeNote") || null }).then(() => undefined));
}

export async function submitAdditionAction(id: string): Promise<FormState> {
  const user = await requireUser();
  return run(() => submitClientAddition(user, id).then(() => undefined));
}

export async function discardAdditionAction(id: string): Promise<FormState> {
  const user = await requireUser();
  return run(() => discardClientAddition(user, id));
}

export async function archiveAgentAction(_prev: FormState | undefined, f: FormData): Promise<FormState> {
  const user = await requireUser();
  return run(() => archiveAgent(user, str(f, "agentId"), str(f, "reason")));
}

export async function setAgentProcessAction(_prev: FormState | undefined, f: FormData): Promise<FormState> {
  const user = await requireUser();
  return run(() => setAgentProcess(user, str(f, "agentId"), str(f, "processId") || null));
}

// Agent categories (24.11.2026).

export async function setAgentCategoriesAction(_prev: FormState | undefined, f: FormData): Promise<FormState> {
  const user = await requireUser();
  return run(() => setAgentCategories(user, str(f, "agentId"), f.getAll("categoryId").map(String).filter(Boolean)));
}

export async function createAgentCategoryAction(_prev: FormState | undefined, f: FormData): Promise<FormState> {
  const user = await requireUser();
  return run(async () => {
    await createAgentCategory(user, str(f, "name"));
  });
}

export async function renameAgentCategoryAction(_prev: FormState | undefined, f: FormData): Promise<FormState> {
  const user = await requireUser();
  return run(() => renameAgentCategory(user, str(f, "id"), str(f, "name")));
}

export async function moveAgentCategoryAction(id: string, direction: "up" | "down"): Promise<FormState> {
  const user = await requireUser();
  return run(() => moveAgentCategory(user, id, direction));
}

export async function setAgentCategoryArchivedAction(id: string, archived: boolean): Promise<FormState> {
  const user = await requireUser();
  return run(() => setAgentCategoryArchived(user, id, archived));
}

export async function setAgentSlugAction(_prev: FormState | undefined, f: FormData): Promise<FormState> {
  const user = await requireUser();
  return run(async () => {
    await setAgentSlug(user, str(f, "agentId"), str(f, "slug"));
    return { slug: str(f, "slug").toLowerCase() };
  });
}

export async function setAgentPurposeAction(_prev: FormState | undefined, f: FormData): Promise<FormState> {
  const user = await requireUser();
  return run(() => setAgentPurpose(user, str(f, "agentId"), str(f, "purpose")));
}

export async function markFaultyAction(_prev: FormState | undefined, f: FormData): Promise<FormState> {
  const user = await requireUser();
  return run(() => markFaulty(user, str(f, "id"), str(f, "reason")).then(() => undefined));
}

export async function revertToVersionAction(agentId: string, version: number): Promise<FormState> {
  const user = await requireUser();
  return run(async () => ({ version: (await revertToVersion(user, agentId, version)).version }));
}

export async function setClientValueAction(_prev: FormState | undefined, f: FormData): Promise<FormState> {
  const user = await requireUser();
  return run(() => setClientValue(user, { agentId: str(f, "agentId"), clientId: str(f, "clientId"), key: str(f, "key"), value: String(f.get("value") ?? "") }));
}

export async function installAction(_prev: FormState | undefined, f: FormData): Promise<FormState> {
  const user = await requireUser();
  return run(async () => {
    const agentId = str(f, "agentId");
    const surface = str(f, "surface");
    const scope = str(f, "clientScope");
    const check = str(f, "checkEvery");
    const values: Record<string, string> = {};
    for (const [k, v] of f.entries()) if (k.startsWith("value:")) values[k.slice(6)] = String(v);
    const cron = str(f, "cron");
    const inst = await createInstallation(user, {
      agentId,
      surface: (["PROJECT", "SCHEDULED", "PERSISTENT_SESSION", "SKILL"].includes(surface) ? surface : "PROJECT") as "PROJECT",
      clientScope: (["ONE", "LIST", "ALL_MINE"].includes(scope) ? scope : "ONE") as "ONE",
      clientIds: f.getAll("clientIds").map(String).filter(Boolean),
      checkEvery: (["RUN", "DAILY", "WEEKLY"].includes(check) ? check : "DAILY") as "DAILY",
      claudeAccount: str(f, "claudeAccount") || null,
      values,
      schedules: cron ? [{ cron, tz: str(f, "tz") || "Asia/Jerusalem" }] : [],
    });
    const agent = await prisma.agent.findUniqueOrThrow({ where: { id: agentId }, select: { name: true } });
    return { bootstrap: bootstrapText(agent, inst.id, user.locale) };
  });
}

export async function removeInstallationAction(installationId: string): Promise<FormState> {
  const user = await requireUser();
  return run(() => removeInstallation(user, installationId));
}

export async function acceptUpdateAction(installationId: string, version: number): Promise<FormState> {
  const user = await requireUser();
  return run(() => acceptUpdate(user, installationId, version).then(() => undefined));
}

// --- Phase 3: library and lessons -------------------------------------------

export async function proposeSharedAction(_prev: FormState | undefined, f: FormData): Promise<FormState> {
  const user = await requireUser();
  return run(() => proposeSharedBlock(user, { key: str(f, "key") || null, title: str(f, "title"), kind: str(f, "kind"), body: String(f.get("body") ?? ""), changeNote: str(f, "changeNote") || null }).then(() => undefined));
}

export async function approveSharedAction(versionId: string): Promise<FormState> {
  const user = await requireUser();
  return run(() => approveSharedVersion(user, versionId).then(() => undefined));
}

export async function rejectSharedAction(_prev: FormState | undefined, f: FormData): Promise<FormState> {
  const user = await requireUser();
  return run(() => rejectSharedVersion(user, str(f, "id"), str(f, "reason")));
}

export async function addFromLibraryAction(_prev: FormState | undefined, f: FormData): Promise<FormState> {
  const user = await requireUser();
  return run(async () => {
    const agentId = str(f, "agentId");
    const block = await sharedBlockForAgent(str(f, "key"));
    const { blocks } = await editable(agentId);
    await saveDraft(user, agentId, { blocks: [...blocks.filter((b) => b.sharedKey !== block.sharedKey), block] });
  });
}

export async function decideLessonAction(lessonId: string, status: "USED" | "DISMISSED"): Promise<FormState> {
  const user = await requireUser();
  return run(() => decideLesson(user, lessonId, status));
}
