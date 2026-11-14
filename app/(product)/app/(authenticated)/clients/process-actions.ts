"use server";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { domainErrorText } from "@/lib/i18n/domain-errors";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { parseSourceRefs } from "@/lib/knowledge-sources";
import {
  addProcess,
  approveProcessVersion,
  linkProcessDates,
  removeProcess,
  setProcessKind,
  discardProcessVersion,
  saveAndActivateProcessVersion,
  saveProcessVersion,
  type SaveAndActivateResult,
  setProcessStatus,
  updateProcess,
  type ProcessInput,
  setProcessFieldNotApplicable,
} from "@/lib/app-domain/processes";
import { startProcessRun } from "@/lib/app-domain/process-runs";
import { addProcessDate } from "@/lib/app-domain/process-dates";
import { previewProcessRhythm, processRhythmContext, saveProcessRhythm, stepsLeadOf, type RhythmPreviewRow } from "@/lib/app-domain/process-rhythm";
import { readRule, readStartInput, type StartInput } from "@/lib/process-rhythm";
import { readProcessDateSchedule } from "@/lib/process-date-schedule";
import { recordProcessCheck } from "@/lib/app-domain/process-checks";
import { markProcessReviewed, rescanAfterRuleChange } from "@/lib/app-domain/process-review";
import { resolveLesson } from "@/lib/app-domain/process-lessons";
import { closeTaskCoveredByProcess } from "@/lib/app-domain/process-overlap";
import { runStep } from "@/lib/app-domain/process-next-steps";
import type { StepOp } from "@/lib/next-steps";
import type { KnowledgeStatus, ProcedureClassification, ProcessTransition, ProcessTrigger } from "@prisma/client";
import { readControlRefs } from "@/lib/procedure-document";
import { approveProcedureTranslation } from "@/lib/app-domain/procedure-documents";
import { itemExtrasFrom } from "./item-extras";

// Org brain, phase 1: processes and their procedures on the client screen
// (claude/org-brain-spec-2026-10-12.md, 3.8, 3.9).

type FormState = { error?: string; ok?: boolean };

const STATUSES: KnowledgeStatus[] = ["CONFIRMED", "UNCERTAIN", "MISSING"];
const TRIGGERS: ProcessTrigger[] = ["SCHEDULED", "EVENT", "ON_DEMAND", "CONTINUOUS"];
const TRANSITIONS: ProcessTransition[] = ["WITH_CLIENT", "IN_HANDOVER", "WITH_ANKORA", "NOT_PLANNED"];
const CLASSIFICATIONS: ProcedureClassification[] = ["PUBLIC", "INTERNAL", "CONFIDENTIAL"];

/// ADR 0006: every refusal in the reader's language. A DomainError
/// (ProcessVersionConflictError among them) is worded from its code;
/// anything else keeps its message, as before.
async function friendlyError(err: unknown): Promise<string> {
  const t = await getTranslations("clients.processes.errors");
  if (err instanceof ForbiddenError) return t("forbidden");
  const domain = await domainErrorText(err);
  if (domain) return domain;
  if (err instanceof Error) return err.message;
  return t("generic");
}

async function errors() {
  return getTranslations("clients.processes.errors");
}

const text = (f: FormData, n: string) => String(f.get(n) ?? "").trim() || null;
const list = (f: FormData, n: string) => f.getAll(n).map(String).filter(Boolean);

async function parseProcess(f: FormData, selfId?: string): Promise<{ error?: string; value?: Omit<ProcessInput, "clientId"> }> {
  const t = await errors();
  const { refs, invalid } = parseSourceRefs(String(f.get("sources") ?? ""));
  if (invalid.length) return { error: t("sourceUnclear", { sources: invalid.join(", ") }) };
  const status = String(f.get("knowledgeStatus") ?? "");
  const transition = String(f.get("transitionStatus") ?? "");
  const sla = text(f, "slaBusinessDays");
  if (sla !== null && !/^\d+$/.test(sla)) return { error: t("slaInteger") };
  const review = text(f, "reviewEveryDays");
  if (review !== null && !/^\d+$/.test(review)) return { error: t("reviewInteger") };
  return {
    value: {
      ...itemExtrasFrom(f, selfId),
      title: String(f.get("title") ?? ""),
      purpose: text(f, "purpose"),
      // 13.11.2026 (stage 1): what starts it, how often it is checked and
      // its business calendar are the rhythm's (saveProcessRhythmAction).
      ownerId: text(f, "ownerId"),
      backupOwnerId: text(f, "backupOwnerId"),
      slaText: text(f, "slaText"),
      slaBusinessDays: sla === null ? null : Number(sla),
      externalPartyContactIds: list(f, "externalPartyContactIds"),
      externalPartyText: text(f, "externalPartyText"),
      requiredSystemIds: list(f, "requiredSystemIds"),
      // Spec 3.9: "systemPermission:<id>", next to each system.
      requiredSystemPermissions: Object.fromEntries(
        [...f.keys()].filter((k) => k.startsWith("systemPermission:")).map((k) => [k.slice("systemPermission:".length), String(f.get(k) ?? "")])
      ),
      approverText: text(f, "approverText"),
      approverUserId: text(f, "approverUserId"),
      approverContactId: text(f, "approverContactId"),
      approvalPolicyIds: list(f, "approvalPolicyIds"),
      approvalText: text(f, "approvalText"),
      exceptionPlaybook: text(f, "exceptionPlaybook"),
      entityId: text(f, "entityId"),
      executorText: text(f, "executorText"),
      executorUserId: text(f, "executorUserId"),
      executorContactId: text(f, "executorContactId"),
      transitionStatus: (TRANSITIONS as string[]).includes(transition) ? (transition as ProcessTransition) : undefined,
      knowledgeStatus: (STATUSES as string[]).includes(status) ? (status as KnowledgeStatus) : undefined,
      toResolve: text(f, "toResolve"),
      reviewEveryDays: review === null ? null : Number(review),
      // The procedure as a document (23.10.2026).
      scope: text(f, "scope"),
      definitions: text(f, "definitions"),
      controlRefs: readControlRefs(String(f.get("controlRefs") ?? "")),
      classification: (CLASSIFICATIONS as string[]).includes(String(f.get("classification") ?? "")) ? (String(f.get("classification")) as ProcedureClassification) : undefined,
      relatedDocs: text(f, "relatedDocs"),
      sources: refs,

      manualConfirm: f.get("manualConfirm") === "1",
    },
  };
}

/// 13.11.2026 (processes redesign, stage 2): the fields each part of the
/// form holds. A form sent with `_parts` changes only those, so editing
/// "who" on the process page leaves the rest of the process as it was.
const PART_FIELDS: Record<string, string[]> = {
  what: ["title", "purpose"],
  who: ["ownerId", "backupOwnerId", "executorText", "executorUserId", "executorContactId", "approverText", "approverUserId", "approverContactId"],
  work: ["slaText", "slaBusinessDays", "requiredSystemIds", "requiredSystemPermissions", "externalPartyContactIds", "externalPartyText", "approvalPolicyIds", "approvalText", "exceptionPlaybook"],
  knowledge: ["transitionStatus", "knowledgeStatus", "toResolve", "entityId", "sources", "manualConfirm"],
  document: ["scope", "definitions", "controlRefs", "classification", "relatedDocs", "reviewEveryDays"],
  // 14.11.2026 (stage 4): the compliance fields of the document's tab.
  compliance: ["scope", "definitions", "controlRefs", "classification", "relatedDocs"],
  sources: ["sources", "manualConfirm", "knowledgeStatus", "toResolve"],
};

function onlyParts<T extends Record<string, unknown>>(f: FormData, value: T, selfId?: string): Partial<T> {
  const parts = String(f.get("_parts") ?? "").split(",").filter(Boolean);
  if (!parts.length) return value;
  const keep = new Set(parts.flatMap((p) => PART_FIELDS[p] ?? []));
  // The knowledge part is also everything ItemExtras sends.
  if (parts.includes("knowledge")) for (const k of Object.keys(itemExtrasFrom(f, selfId))) keep.add(k);
  return Object.fromEntries(Object.entries(value).filter(([k]) => keep.has(k))) as Partial<T>;
}

async function run(clientId: string, fn: () => Promise<unknown>): Promise<FormState> {
  try {
    await fn();
  } catch (err) {
    return { error: await friendlyError(err) };
  }
  revalidatePath(`/app/clients/${clientId}`);
  return { ok: true };
}

export async function addProcessAction(_prev: FormState | undefined, f: FormData): Promise<FormState & { id?: string }> {
  const user = await requireUser();
  const clientId = String(f.get("clientId") ?? "");
  const parsed = await parseProcess(f, user.id);
  if (parsed.error || !parsed.value) return { error: parsed.error };
  // 13.11.2026 (stage 2): the new process's id, so the screen can open its
  // page and its rhythm right after.
  const created: { id?: string } = {};
  const r = await run(clientId, async () => {
    created.id = (await addProcess(user, { ...parsed.value!, clientId })).id;
  });
  return created.id ? { ...r, id: created.id } : r;
}

export async function updateProcessAction(_prev: FormState | undefined, f: FormData): Promise<FormState> {
  const user = await requireUser();
  const clientId = String(f.get("clientId") ?? "");
  const parsed = await parseProcess(f, user.id);
  if (parsed.error || !parsed.value) return { error: parsed.error };
  // The entity and the external parties are what separation rules read:
  // a change to them is a change to what the rules say about the process.
  return run(clientId, async () => {
    const p = await updateProcess(user, String(f.get("id") ?? ""), onlyParts(f, parsed.value!, user.id));
    await rescanAfterRuleChange(clientId, `התהליך ${p.code} עודכן`);
  });
}

export async function markProcessReviewedAction(processId: string, clientId: string): Promise<FormState> {
  const user = await requireUser();
  return run(clientId, () => markProcessReviewed(user, processId));
}

/// "לסגור, התהליך מכסה את זה" (21.10.2026): an open task the approved
/// process already covers goes to the archive, with a comment.
export async function closeCoveredTaskAction(taskId: string, processId: string, clientId: string): Promise<FormState> {
  const user = await requireUser();
  const r = await run(clientId, () => closeTaskCoveredByProcess(user, taskId, processId));
  if (r.ok) {
    revalidatePath("/app/tasks");
    revalidatePath("/app/approvals");
  }
  return r;
}

/// "הצעד הבא" on a process card (22.10.2026): the step it recommends,
/// carried out through the same door as on "אישורים".
export async function runProcessStepAction(op: StepOp, clientId: string): Promise<FormState & { done?: string }> {
  const user = await requireUser();
  let done = "";
  const r = await run(clientId, async () => {
    done = await runStep(user, op);
  });
  if (r.ok) {
    revalidatePath("/app/tasks");
    revalidatePath("/app", "layout");
  }
  return r.ok ? { ...r, done } : r;
}

/// 14.11.2026 (stage 4): marks a documentation field "לא רלוונטי" from the
/// readiness list of the procedure document's tab.
export async function markProcessFieldNotApplicableAction(processId: string, field: string, clientId: string): Promise<FormState> {
  const user = await requireUser();
  return run(clientId, () => setProcessFieldNotApplicable(user, processId, field, true));
}

/// 25.10.2026: takes the "לא רלוונטי" mark off a documentation field.
export async function restoreProcessFieldAction(processId: string, field: string, clientId: string): Promise<FormState> {
  const user = await requireUser();
  return run(clientId, () => setProcessFieldNotApplicable(user, processId, field, false));
}

/// Learning from runs (spec 5.4): a remark on the procedure went into it,
/// or does not belong there.
export async function resolveLessonAction(_prev: FormState | undefined, f: FormData): Promise<FormState> {
  const user = await requireUser();
  const status = String(f.get("status") ?? "");
  if (status !== "APPLIED" && status !== "DISMISSED") return { error: (await errors())("lessonChoice") };
  return run(String(f.get("clientId") ?? ""), () => resolveLesson(user, String(f.get("id") ?? ""), status, String(f.get("resolution") ?? "")));
}

export async function saveProcessVersionAction(_prev: FormState | undefined, f: FormData): Promise<FormState> {
  const user = await requireUser();
  const clientId = String(f.get("clientId") ?? "");
  let steps: unknown;
  try {
    steps = JSON.parse(String(f.get("steps") ?? "[]"));
  } catch {
    return { error: (await errors())("stepsUnread") };
  }
  return run(clientId, () =>
    saveProcessVersion(user, String(f.get("processId") ?? ""), {
      steps,
      highlights: text(f, "highlights"),
      outputs: text(f, "outputs"),
      changeNote: text(f, "changeNote"),
      baseVersion: Number(f.get("baseVersion") ?? 0),
    })
  );
}

/// "שמור והפעל" from the flow editor (task cmvtivumj000pjs08q9qj4t67): the
/// flow goes live at once, or waits for a second pair of eyes and says why.
export async function saveAndActivateFlowAction(input: {
  clientId: string;
  processId: string;
  flow: unknown;
  baseVersion: number;
  changeNote?: string | null;
  /// Carried from the version being edited: the flow editor does not edit them.
  highlights?: string | null;
  outputs?: string | null;
}): Promise<{ error?: string; result?: SaveAndActivateResult }> {
  const user = await requireUser();
  try {
    const result = await saveAndActivateProcessVersion(user, input.processId, {
      steps: [],
      flow: input.flow,
      highlights: input.highlights ?? null,
      outputs: input.outputs ?? null,
      changeNote: input.changeNote ?? null,
      baseVersion: input.baseVersion,
    });
    revalidatePath(`/app/clients/${input.clientId}`);
    if (result.live) return { result };
    // Why it is not live, in the reader's language. The refusal that held
    // the approval back is an Error and does not cross to the browser.
    const { reasonKey, reasonError, ...rest } = result;
    const t = await getTranslations("clients.processes.flow.reasons");
    const reason =
      reasonKey === "waitingSecondEye"
        ? t("waitingSecondEye", { titles: result.secondEye.map((x) => `"${x}"`).join(", ") })
        : reasonKey
          ? t(reasonKey)
          : reasonError
            ? await friendlyError(reasonError)
            : result.reason;
    return { result: { ...rest, reason } };
  } catch (err) {
    return { error: await friendlyError(err) };
  }
}

/// 14.11.2026 (processes redesign, stage 3, "Steps.dc.html"): the steps
/// editor's two buttons. "שמירת טיוטה" saves a draft; "שמירה ואישור", for
/// whoever approves procedures of the client, saves and approves through
/// the same checks and second pair of eyes as "שמור והפעל" did (Ariel,
/// 14.11.2026). A list is saved as steps, a flow as a flow; the version's
/// highlights and outputs are carried as they were.
export async function saveStepsAction(input: {
  clientId: string;
  processId: string;
  baseVersion: number;
  steps?: unknown;
  flow?: unknown;
  approve: boolean;
  highlights?: string | null;
  outputs?: string | null;
}): Promise<{ error?: string; version?: number; live?: boolean; reason?: string }> {
  const user = await requireUser();
  const version = { steps: input.steps ?? [], flow: input.flow ?? undefined, highlights: input.highlights ?? null, outputs: input.outputs ?? null, baseVersion: input.baseVersion };
  try {
    if (!input.approve) {
      const row = await saveProcessVersion(user, input.processId, version);
      revalidatePath(`/app/clients/${input.clientId}`);
      return { version: row.version, live: false };
    }
    const result = await saveAndActivateProcessVersion(user, input.processId, version);
    revalidatePath(`/app/clients/${input.clientId}`);
    if (result.live) return { version: result.version, live: true };
    const t = await getTranslations("clients.processes.flow.reasons");
    const reason =
      result.reasonKey === "waitingSecondEye"
        ? t("waitingSecondEye", { titles: result.secondEye.map((x) => `"${x}"`).join(", ") })
        : result.reasonKey
          ? t(result.reasonKey)
          : result.reasonError
            ? await friendlyError(result.reasonError)
            : result.reason;
    return { version: result.version, live: false, reason };
  } catch (err) {
    return { error: await friendlyError(err) };
  }
}

export async function approveProcessVersionAction(processId: string, version: number, clientId: string): Promise<FormState> {
  const user = await requireUser();
  return run(clientId, () => approveProcessVersion(user, processId, version));
}

export async function setProcessStatusAction(processId: string, status: "ACTIVE" | "PAUSED" | "RETIRED", clientId: string): Promise<FormState> {
  const user = await requireUser();
  return run(clientId, () => setProcessStatus(user, processId, status));
}

export async function discardProcessVersionAction(processId: string, version: number, clientId: string): Promise<FormState> {
  const user = await requireUser();
  return run(clientId, () => discardProcessVersion(user, processId, version));
}

export async function setProcessKindAction(processId: string, kind: "PROCESS" | "GUIDE", clientId: string): Promise<FormState> {
  const user = await requireUser();
  return run(clientId, () => setProcessKind(user, processId, kind));
}

export async function removeProcessAction(processId: string, clientId: string): Promise<FormState> {
  const user = await requireUser();
  return run(clientId, () => removeProcess(user, processId));
}

export async function linkProcessDatesAction(_prev: FormState | undefined, f: FormData): Promise<FormState> {
  const user = await requireUser();
  const clientId = String(f.get("clientId") ?? "");
  return run(clientId, () => linkProcessDates(user, String(f.get("processId") ?? ""), list(f, "dateIds")));
}

/// A new date that starts the process, created and linked in one step.
export async function addProcessDateAction(_prev: FormState | undefined, f: FormData): Promise<FormState> {
  const user = await requireUser();
  const clientId = String(f.get("clientId") ?? "");
  const schedule = readProcessDateSchedule({
    recurrence: String(f.get("recurrence") ?? ""),
    weekday: String(f.get("weekday") ?? ""),
    dayOfMonth: String(f.get("dayOfMonth") ?? ""),
    onceDate: String(f.get("onceDate") ?? ""),
  });
  if ("error" in schedule) return { error: schedule.error };
  return run(clientId, () => addProcessDate(user, String(f.get("processId") ?? ""), schedule));
}

export async function startProcessRunAction(_prev: FormState | undefined, f: FormData): Promise<FormState> {
  const user = await requireUser();
  const clientId = String(f.get("clientId") ?? "");
  const day = String(f.get("day") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { error: (await errors())("runDate") };
  return run(clientId, () => startProcessRun(user, String(f.get("processId") ?? ""), new Date(`${day}T00:00:00Z`)));
}

export async function recordProcessCheckAction(_prev: FormState | undefined, f: FormData): Promise<FormState> {
  const user = await requireUser();
  const clientId = String(f.get("clientId") ?? "");
  const outcome = String(f.get("outcome") ?? "");
  if (outcome !== "OK" && outcome !== "ISSUE") return { error: (await errors())("checkOutcome") };
  const from = String(f.get("from") ?? "");
  try {
    await recordProcessCheck(user, String(f.get("processId") ?? ""), { outcome, note: text(f, "note") });
  } catch (err) {
    return { error: await friendlyError(err) };
  }
  revalidatePath(`/app/clients/${clientId}`);
  // From the home screen's routine, the home screen is what changed.
  if (from === "home") revalidatePath("/app");
  return { ok: true };
}

/// A manager approves the English translation of a procedure version
/// (23.10.2026). Only an approved translation is exported.
export async function approveProcedureTranslationAction(processId: string, version: number, clientId: string): Promise<FormState> {
  const user = await requireUser();
  try {
    await approveProcedureTranslation(user, processId, version);
  } catch (err) {
    return { error: await friendlyError(err) };
  }
  revalidatePath(`/app/clients/${clientId}/processes/${processId}/document`);
  revalidatePath(`/app/clients/${clientId}/procedures`);
  return { ok: true };
}

/// 13.11.2026 (processes redesign, stage 1): the whole rhythm, from the
/// rhythm editor.
export async function saveProcessRhythmAction(clientId: string, processId: string, payload: { starts: unknown[]; businessCalendar?: string | null }): Promise<FormState> {
  const user = await requireUser();
  const starts = (Array.isArray(payload.starts) ? payload.starts : []).map(readStartInput);
  if (starts.some((s) => s === null)) return { error: (await errors())("rhythmUnread") };
  return run(clientId, () => saveProcessRhythm(user, processId, starts as StartInput[], undefined, { businessCalendar: payload.businessCalendar }));
}

/// The calendar line and the steps' lead, when the editor opens.
export async function processRhythmContextAction(processId: string) {
  const user = await requireUser();
  try {
    return { context: await processRhythmContext(user, processId) };
  } catch (err) {
    return { error: await friendlyError(err) };
  }
}

/// The next occurrences of a schedule the editor has not saved yet.
export async function previewProcessRhythmAction(processId: string, rule: unknown): Promise<{ rows?: RhythmPreviewRow[]; stepsLead?: number; error?: string }> {
  const user = await requireUser();
  const read = readRule(rule);
  if (!read) return { error: (await errors())("rhythmUnread") };
  try {
    const [rows, stepsLead] = await Promise.all([previewProcessRhythm(user, processId, read), stepsLeadOf(processId)]);
    return { rows, stepsLead };
  } catch (err) {
    return { error: await friendlyError(err) };
  }
}
