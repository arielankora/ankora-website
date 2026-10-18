"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { parseSourceRefs } from "@/lib/knowledge-sources";
import {
  addProcess,
  approveProcessVersion,
  linkProcessDates,
  removeProcess,
  saveProcessVersion,
  setProcessStatus,
  updateProcess,
  ProcessVersionConflictError,
  type ProcessInput,
} from "@/lib/app-domain/processes";
import { startProcessRun } from "@/lib/app-domain/process-runs";
import { recordProcessCheck } from "@/lib/app-domain/process-checks";
import { markProcessReviewed, rescanAfterRuleChange } from "@/lib/app-domain/process-review";
import { resolveLesson } from "@/lib/app-domain/process-lessons";
import type { KnowledgeStatus, ProcessTransition, ProcessTrigger } from "@prisma/client";

// Org brain, phase 1: processes and their procedures on the client screen
// (claude/org-brain-spec-2026-10-12.md, 3.8, 3.9).

type FormState = { error?: string; ok?: boolean };

const STATUSES: KnowledgeStatus[] = ["CONFIRMED", "UNCERTAIN", "MISSING"];
const TRIGGERS: ProcessTrigger[] = ["SCHEDULED", "EVENT", "ON_DEMAND", "CONTINUOUS"];
const TRANSITIONS: ProcessTransition[] = ["WITH_CLIENT", "IN_HANDOVER", "WITH_ANKORA", "NOT_PLANNED"];

function friendlyError(err: unknown): string {
  if (err instanceof ForbiddenError) return "אין לך הרשאה לפעולה זו - הלקוח אינו משויך אליך.";
  if (err instanceof ProcessVersionConflictError) return err.message;
  if (err instanceof Error) return err.message;
  return "אירעה שגיאה. נסו שוב.";
}

const text = (f: FormData, n: string) => String(f.get(n) ?? "").trim() || null;
const list = (f: FormData, n: string) => f.getAll(n).map(String).filter(Boolean);

function parseProcess(f: FormData): { error?: string; value?: Omit<ProcessInput, "clientId"> } {
  const { refs, invalid } = parseSourceRefs(String(f.get("sources") ?? ""));
  if (invalid.length) return { error: `מקור לא מובן: ${invalid.join(", ")}. כותבים קוד ודקה, למשל S1 08:13.` };
  const status = String(f.get("knowledgeStatus") ?? "");
  const transition = String(f.get("transitionStatus") ?? "");
  const sla = text(f, "slaBusinessDays");
  if (sla !== null && !/^\d+$/.test(sla)) return { error: "ה-SLA בימי עסקים הוא מספר שלם." };
  const every = text(f, "checkEveryDays");
  if (every !== null && !/^\d+$/.test(every)) return { error: "הבדיקה היא כל מספר שלם של ימים." };
  const review = text(f, "reviewEveryDays");
  if (review !== null && !/^\d+$/.test(review)) return { error: "הסקירה היא כל מספר שלם של ימים." };
  return {
    value: {
      title: String(f.get("title") ?? ""),
      purpose: text(f, "purpose"),
      triggerKinds: list(f, "triggerKinds").filter((t): t is ProcessTrigger => (TRIGGERS as string[]).includes(t)),
      triggerText: text(f, "triggerText"),
      ownerId: text(f, "ownerId"),
      backupOwnerId: text(f, "backupOwnerId"),
      slaText: text(f, "slaText"),
      slaBusinessDays: sla === null ? null : Number(sla),
      externalPartyContactIds: list(f, "externalPartyContactIds"),
      externalPartyText: text(f, "externalPartyText"),
      requiredSystemIds: list(f, "requiredSystemIds"),
      approverText: text(f, "approverText"),
      approverUserId: text(f, "approverUserId"),
      approverContactId: text(f, "approverContactId"),
      approvalPolicyIds: list(f, "approvalPolicyIds"),
      approvalText: text(f, "approvalText"),
      exceptionPlaybook: text(f, "exceptionPlaybook"),
      entityId: text(f, "entityId"),
      businessCalendar: text(f, "businessCalendar"),
      executorText: text(f, "executorText"),
      transitionStatus: (TRANSITIONS as string[]).includes(transition) ? (transition as ProcessTransition) : undefined,
      knowledgeStatus: (STATUSES as string[]).includes(status) ? (status as KnowledgeStatus) : undefined,
      toResolve: text(f, "toResolve"),
      checkEveryDays: every === null ? null : Number(every),
      checkText: text(f, "checkText"),
      reviewEveryDays: review === null ? null : Number(review),
      sources: refs,
    },
  };
}

async function run(clientId: string, fn: () => Promise<unknown>): Promise<FormState> {
  try {
    await fn();
  } catch (err) {
    return { error: friendlyError(err) };
  }
  revalidatePath(`/app/clients/${clientId}`);
  return { ok: true };
}

export async function addProcessAction(_prev: FormState | undefined, f: FormData): Promise<FormState> {
  const user = await requireUser();
  const clientId = String(f.get("clientId") ?? "");
  const parsed = parseProcess(f);
  if (parsed.error || !parsed.value) return { error: parsed.error };
  return run(clientId, () => addProcess(user, { ...parsed.value!, clientId }));
}

export async function updateProcessAction(_prev: FormState | undefined, f: FormData): Promise<FormState> {
  const user = await requireUser();
  const clientId = String(f.get("clientId") ?? "");
  const parsed = parseProcess(f);
  if (parsed.error || !parsed.value) return { error: parsed.error };
  // The entity and the external parties are what separation rules read:
  // a change to them is a change to what the rules say about the process.
  return run(clientId, async () => {
    const p = await updateProcess(user, String(f.get("id") ?? ""), parsed.value!);
    await rescanAfterRuleChange(clientId, `התהליך ${p.code} עודכן`);
  });
}

export async function markProcessReviewedAction(processId: string, clientId: string): Promise<FormState> {
  const user = await requireUser();
  return run(clientId, () => markProcessReviewed(user, processId));
}

/// Learning from runs (spec 5.4): a remark on the procedure went into it,
/// or does not belong there.
export async function resolveLessonAction(_prev: FormState | undefined, f: FormData): Promise<FormState> {
  const user = await requireUser();
  const status = String(f.get("status") ?? "");
  if (status !== "APPLIED" && status !== "DISMISSED") return { error: "בוחרים אם זה נכנס לנוהל או לא." };
  return run(String(f.get("clientId") ?? ""), () => resolveLesson(user, String(f.get("id") ?? ""), status, String(f.get("resolution") ?? "")));
}

export async function saveProcessVersionAction(_prev: FormState | undefined, f: FormData): Promise<FormState> {
  const user = await requireUser();
  const clientId = String(f.get("clientId") ?? "");
  let steps: unknown;
  try {
    steps = JSON.parse(String(f.get("steps") ?? "[]"));
  } catch {
    return { error: "השלבים לא נקראו. רעננו ונסו שוב." };
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

export async function approveProcessVersionAction(processId: string, version: number, clientId: string): Promise<FormState> {
  const user = await requireUser();
  return run(clientId, () => approveProcessVersion(user, processId, version));
}

export async function setProcessStatusAction(processId: string, status: "ACTIVE" | "PAUSED" | "RETIRED", clientId: string): Promise<FormState> {
  const user = await requireUser();
  return run(clientId, () => setProcessStatus(user, processId, status));
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

export async function startProcessRunAction(_prev: FormState | undefined, f: FormData): Promise<FormState> {
  const user = await requireUser();
  const clientId = String(f.get("clientId") ?? "");
  const day = String(f.get("day") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { error: "צריך תאריך לריצה." };
  return run(clientId, () => startProcessRun(user, String(f.get("processId") ?? ""), new Date(`${day}T00:00:00Z`)));
}

export async function recordProcessCheckAction(_prev: FormState | undefined, f: FormData): Promise<FormState> {
  const user = await requireUser();
  const clientId = String(f.get("clientId") ?? "");
  const outcome = String(f.get("outcome") ?? "");
  if (outcome !== "OK" && outcome !== "ISSUE") return { error: "מה נמצא בבדיקה?" };
  const from = String(f.get("from") ?? "");
  try {
    await recordProcessCheck(user, String(f.get("processId") ?? ""), { outcome, note: text(f, "note") });
  } catch (err) {
    return { error: friendlyError(err) };
  }
  revalidatePath(`/app/clients/${clientId}`);
  // From the home screen's routine, the home screen is what changed.
  if (from === "home") revalidatePath("/app");
  return { ok: true };
}
