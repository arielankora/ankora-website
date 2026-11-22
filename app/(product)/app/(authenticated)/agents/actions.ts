"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { domainErrorText } from "@/lib/i18n/domain-errors";
import { prisma } from "@/lib/prisma";
import {
  acceptUpdate,
  approveVersion,
  contentOf,
  createAgent,
  createInstallation,
  discardDraft,
  rejectVersion,
  removeInstallation,
  saveDraft,
  setClientValue,
  submitDraft,
} from "@/lib/app-domain/agents";
import { BLOCK_KINDS, CLIENT_FIELDS, PARAM_LEVELS, PARAM_TYPES, type AgentBlock, type AgentParam } from "@/lib/agents/model";
import { bootstrapText } from "@/lib/agents/compile";

// Agents, phase 1: the screens' writes. Every one goes through
// lib/app-domain/agents.ts, the same functions the MCP tools call.

type FormState = { error?: string; ok?: boolean; slug?: string; bootstrap?: string };

async function friendlyError(err: unknown): Promise<string> {
  if (err instanceof ForbiddenError) return "אין לך הרשאה לפעולה הזו.";
  const domain = await domainErrorText(err);
  if (domain) return domain;
  if (err instanceof Error) return err.message;
  return "משהו השתבש. כדאי לנסות שוב.";
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
      clientId: str(f, "clientId") || null,
      safety: f.get("safety") === "on",
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
      requirements: { connectors: list(f, "connectors"), skills: list(f, "skills"), repos: list(f, "repos"), localMcp: list(f, "localMcp"), externalRunners: list(f, "externalRunners"), model: str(f, "model") || null, notes: str(f, "notes") || null },
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

export async function approveVersionAction(versionId: string): Promise<FormState> {
  const user = await requireUser();
  return run(() => approveVersion(user, versionId).then(() => undefined));
}

export async function rejectVersionAction(_prev: FormState | undefined, f: FormData): Promise<FormState> {
  const user = await requireUser();
  return run(() => rejectVersion(user, str(f, "id"), str(f, "reason")).then(() => undefined));
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
    return { bootstrap: bootstrapText(agent, inst.id) };
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
