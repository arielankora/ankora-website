import "server-only";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/app-auth/audit";
import { addBusinessDays } from "@/lib/business-calendar";
import { localDateKey, TIMEZONE } from "@/lib/timezone";
import { appBaseUrl } from "@/lib/email-templates";
import { CURRENT_AGREEMENTS, agreementCode, hasSignedCurrent } from "@/lib/agreements";
import { OPEN_STATUSES, assignableUsers, completeStepAsSystem, createTask, updateTask } from "@/lib/app-domain/tasks";
import { revokeClaudeGrantsForUser } from "@/lib/app-domain/mcp-connections";
import { isDemoName } from "@/lib/mcp/category-pick";
import {
  ONBOARDING_PDF_STEP,
  ONBOARDING_SIGN_STEP,
  ONBOARDING_STEPS,
  OFFBOARDING_STEPS,
  offboardingDescription,
  offboardingPrompt,
  onboardingDescription,
  onboardingPrompt,
} from "@/lib/employee-lifecycle-prompts";
import type { EmployeeLifecycleKind, TaskStatus, User } from "@prisma/client";

// Employee lifecycle: the tasks the server opens when a staff member is
// invited (onboarding) or suspended (offboarding), and the access the
// server revokes itself on suspension.
//
// Every entry point here is called from inside another flow (inviting a
// user, changing a status, signing an agreement) and NEVER throws into
// it. Inviting someone must not fail because the internal client was
// renamed, and a suspension must not be rolled back because Drive or a
// task write misbehaved: the suspension is the security act, the task is
// the paperwork around it. A failure is logged and audited as
// `employee_lifecycle.trigger_failed`, so it shows in the audit log rather than
// only in a server log nobody reads.

const DEFAULT_ONBOARDING_OWNER = "hadas@ankora.co.il";
const DEFAULT_OFFBOARDING_OWNER = "ariel@ankora.co.il";
const INTERNAL_CLIENT_NAME = "Ankora פנימי";

/// Business days to finish onboarding, and the DPA's deadline for
/// revoking a departing person's access.
export const ONBOARDING_DUE_BUSINESS_DAYS = 5;
export const OFFBOARDING_DUE_BUSINESS_DAYS = 3;

const CLOSED_STATUSES: TaskStatus[] = ["DONE", "ARCHIVED"];

/// The due date `days` Israeli business days from `now`, as UTC midnight
/// of that day: the same kind of value the date field on the task screen
/// writes. Also returns the key for display.
export function businessDueDate(days: number, now: Date = new Date()): { date: Date; key: string } {
  const key = addBusinessDays(localDateKey(now, TIMEZONE), days, "IL");
  return { date: new Date(key), key };
}

/// "2026-10-20" to "20.10.2026".
export function displayDate(key: string): string {
  const [y, m, d] = key.split("-");
  return `${d}.${m}.${y}`;
}

/// Pure: may a new offboarding task be opened, given the person's
/// existing ones? Only when none is still open. Suspending, reactivating
/// and suspending again inside one departure must not produce a second
/// checklist; a finished or archived one is history, and a new departure
/// gets a new task.
export function shouldOpenOffboarding(existing: { status: TaskStatus }[]): boolean {
  return !existing.some((t) => !CLOSED_STATUSES.includes(t.status));
}

/// The internal client: by id from INTERNAL_CLIENT_ID when set, else by
/// its exact name. Either way it must be live and active, because a task
/// on an archived client is invisible to everyone it is meant for.
export async function resolveInternalClient(): Promise<{ id: string; name: string } | null> {
  const id = process.env.INTERNAL_CLIENT_ID?.trim();
  if (id) {
    const byId = await prisma.client.findFirst({
      where: { id, deletedAt: null, status: "ACTIVE" },
      select: { id: true, name: true },
    });
    if (byId) return byId;
  }
  return prisma.client.findFirst({
    where: { name: INTERNAL_CLIENT_NAME, deletedAt: null, status: "ACTIVE" },
    select: { id: true, name: true },
  });
}

/// The person who owns the task: from the env (with Ariel's defaults),
/// if that person is active staff who can be assigned work on the
/// internal client. Otherwise the person who triggered the flow, so the
/// task always lands on somebody who is looking at the screen right now.
async function resolveOwner(actor: User, kind: EmployeeLifecycleKind, clientId: string): Promise<User> {
  const email = (
    kind === "ONBOARDING"
      ? process.env.ONBOARDING_OWNER_EMAIL || DEFAULT_ONBOARDING_OWNER
      : process.env.OFFBOARDING_OWNER_EMAIL || DEFAULT_OFFBOARDING_OWNER
  )
    .trim()
    .toLowerCase();
  const owner = await prisma.user.findFirst({
    where: { email, deletedAt: null, status: "ACTIVE", role: { not: "CLIENT_USER" } },
  });
  if (!owner) return actor;
  const assignable = await assignableUsers(actor, clientId);
  return assignable.some((u) => u.id === owner.id) ? owner : actor;
}

const DEFAULT_LIFECYCLE_CATEGORY = "גיוס וhr";

/// The category for both lifecycle tasks: named, not guessed. Guessing
/// put an onboarding task under a seeded demo category on the preview of
/// PR #212. The name comes from EMPLOYEE_LIFECYCLE_CATEGORY (case does not
/// matter, since "HR" is typed both ways), and the row has to be usable
/// on the internal client by createTask's own rule: global or that
/// client's own, and active. Only when there is no such row does the
/// automatic pick run, and even then never onto a demo category.
async function pickCategoryId(actor: User, clientId: string, text: string): Promise<string | null> {
  const name = (process.env.EMPLOYEE_LIFECYCLE_CATEGORY || DEFAULT_LIFECYCLE_CATEGORY).trim();
  const named = await prisma.category.findFirst({
    where: {
      name: { equals: name, mode: "insensitive" },
      active: true,
      OR: [{ visibility: "GLOBAL" }, { visibility: "CLIENT", clientId }],
    },
    select: { id: true },
  });
  if (named) return named.id;

  try {
    // Dynamic: lib/mcp/lookup imports the users module, which calls into
    // this one, and a static import would close that loop at load time.
    const { autoPickCategory } = await import("@/lib/mcp/lookup");
    const pick = await autoPickCategory(actor, clientId, text);
    return pick && !isDemoName(pick.name) ? pick.id : null;
  } catch {
    return null;
  }
}

async function recordFailure(actor: User | null, subjectUserId: string, stage: string, err: unknown) {
  console.error(`[employee-lifecycle] ${stage} failed for ${subjectUserId}:`, err);
  try {
    await recordAudit({
      actorId: actor?.id ?? null,
      action: "employee_lifecycle.trigger_failed",
      entityType: "User",
      entityId: subjectUserId,
      after: { stage, error: err instanceof Error ? err.message : String(err) },
    });
  } catch (auditErr) {
    console.error("[employee-lifecycle] could not audit the failure:", auditErr);
  }
}

/// A comment written by the system rather than a person, the way a job
/// writes one: no author, and audited with no actor.
async function systemComment(taskId: string, clientId: string, body: string) {
  const comment = await prisma.taskComment.create({ data: { taskId, authorId: null, body } });
  await recordAudit({
    actorId: null,
    action: "task.comment",
    entityType: "Task",
    entityId: taskId,
    clientId,
    after: { commentId: comment.id, system: true },
  });
}

/// Creates the parent task, its steps in order, and closes step 1.
async function openLifecycleTask(
  actor: User,
  input: {
    kind: EmployeeLifecycleKind;
    subject: User;
    clientId: string;
    title: string;
    priority: "NORMAL" | "HIGH";
    dueDate: Date;
    steps: readonly string[];
    describe: (taskId: string, owner: User) => string;
  }
) {
  const owner = await resolveOwner(actor, input.kind, input.clientId);
  const categoryId = await pickCategoryId(actor, input.clientId, input.title);

  // Through createTask, so the access rules, the audit row and the
  // assignment notification (bell and morning digest) are the ordinary
  // ones and not a second copy of them. createTask also records who the
  // task is about.
  const task = await createTask(actor, {
    clientId: input.clientId,
    categoryId,
    title: input.title,
    priority: input.priority,
    assignedToId: owner.id,
    dueDate: input.dueDate,
    clientVisible: false,
    subject: { userId: input.subject.id, kind: input.kind },
  });
  await recordAudit({
    actorId: actor.id,
    action: "employee_lifecycle.task_opened",
    entityType: "Task",
    entityId: task.id,
    clientId: task.clientId,
    after: { kind: input.kind, subjectUserId: input.subject.id, ownerId: owner.id },
  });

  // The description names the task's own id, so it is written once the
  // id exists.
  await updateTask(actor, task.id, { description: input.describe(task.id, owner) });

  const steps = [];
  for (const title of input.steps) {
    steps.push(await createTask(actor, { clientId: input.clientId, title, parentId: task.id }));
  }
  // Step 1 is what just happened.
  await updateTask(actor, steps[0].id, { status: "DONE" });

  return { task, steps, owner };
}

/// Called by inviteUser for a staff invite.
export async function openOnboardingTask(actor: User, subject: User): Promise<string | null> {
  if (subject.role === "CLIENT_USER") return null;
  try {
    const client = await resolveInternalClient();
    if (!client) throw new Error("Internal client not found (INTERNAL_CLIENT_ID or the name 'Ankora פנימי').");

    const { date } = businessDueDate(ONBOARDING_DUE_BUSINESS_DAYS);
    const { task } = await openLifecycleTask(actor, {
      kind: "ONBOARDING",
      subject,
      clientId: client.id,
      title: `קליטת עובד: ${subject.name}`,
      priority: "NORMAL",
      dueDate: date,
      steps: ONBOARDING_STEPS,
      describe: (taskId) =>
        onboardingDescription({
          employeeName: subject.name,
          role: subject.role,
          workEmail: subject.email,
          hasPersonalEmail: !!subject.personalEmail,
          prompt: onboardingPrompt({
            employeeName: subject.name,
            employeeEmail: subject.email,
            userId: subject.id,
            taskId,
            code: agreementCode("CONFIDENTIALITY", CURRENT_AGREEMENTS.CONFIDENTIALITY),
          }),
        }),
    });
    return task.id;
  } catch (err) {
    await recordFailure(actor, subject.id, "onboarding_task", err);
    return null;
  }
}

export interface RevocationCounts {
  passkeys: number;
  stepUpGrants: number;
  signLinks: number;
  claudeGrants: number;
}

/// What the app itself can take away from someone being suspended, on
/// top of the session cut (tokenVersion) that updateUserRoleStatus
/// already makes. Each class is audited once, with its count, including
/// a count of zero: "we checked and there was nothing" is worth keeping.
///
/// Deletion declaration links are deliberately left alive: that is the
/// one link a departing person still needs.
export async function revokeAccessOnSuspension(actor: User, userId: string): Promise<RevocationCounts> {
  const passkeys = await prisma.passkey.deleteMany({ where: { userId } });
  await recordAudit({
    actorId: actor.id,
    action: "employee.passkeys_removed",
    entityType: "User",
    entityId: userId,
    after: { count: passkeys.count },
  });

  const grants = await prisma.stepUpGrant.deleteMany({ where: { userId } });
  await recordAudit({
    actorId: actor.id,
    action: "employee.step_up_revoked",
    entityType: "User",
    entityId: userId,
    after: { count: grants.count },
  });

  const links = await prisma.agreementSignLink.updateMany({
    where: { userId, usedAt: null, kind: { not: "DELETION_DECLARATION" } },
    data: { usedAt: new Date() },
  });
  await recordAudit({
    actorId: actor.id,
    action: "employee.sign_links_expired",
    entityType: "User",
    entityId: userId,
    after: { count: links.count },
  });

  // The existing admin path, which audits itself (mcp_grant.revoke_all).
  const claude = await revokeClaudeGrantsForUser(actor, userId);

  return {
    passkeys: passkeys.count,
    stepUpGrants: grants.count,
    signLinks: links.count,
    claudeGrants: claude.ok ? claude.revoked : 0,
  };
}

/// Called by updateUserRoleStatus on the transition into SUSPENDED.
/// Revokes first and opens the task second, so a failure in the
/// paperwork can never leave access standing.
export async function runOffboarding(actor: User, subject: User): Promise<string | null> {
  if (subject.role === "CLIENT_USER") return null;

  let counts: RevocationCounts | null = null;
  try {
    counts = await revokeAccessOnSuspension(actor, subject.id);
  } catch (err) {
    await recordFailure(actor, subject.id, "offboarding_revoke", err);
  }

  try {
    const existing = await prisma.task.findMany({
      where: { subjectUserId: subject.id, lifecycleKind: "OFFBOARDING", deletedAt: null, parentId: null },
      select: { status: true },
    });
    if (!shouldOpenOffboarding(existing)) return null;

    const client = await resolveInternalClient();
    if (!client) throw new Error("Internal client not found (INTERNAL_CLIENT_ID or the name 'Ankora פנימי').");

    const access = await prisma.userClientAccess.findMany({
      where: { userId: subject.id },
      select: { client: { select: { name: true } } },
      orderBy: { client: { name: "asc" } },
    });
    const { date, key } = businessDueDate(OFFBOARDING_DUE_BUSINESS_DAYS);
    const deadline = displayDate(key);
    const adminUrl = `${appBaseUrl()}/app/users/${subject.id}`;

    const { task } = await openLifecycleTask(actor, {
      kind: "OFFBOARDING",
      subject,
      clientId: client.id,
      title: `עזיבת עובד: ${subject.name}`,
      priority: "HIGH",
      dueDate: date,
      steps: OFFBOARDING_STEPS,
      describe: (taskId) =>
        offboardingDescription({
          employeeName: subject.name,
          role: subject.role,
          workEmail: subject.email,
          personalEmail: subject.personalEmail,
          deadline,
          userPageUrl: adminUrl,
          clientNames: access.map((a) => a.client.name),
          prompt: offboardingPrompt({
            employeeName: subject.name,
            userId: subject.id,
            taskId,
            code: agreementCode("DELETION_DECLARATION", CURRENT_AGREEMENTS.DELETION_DECLARATION),
            deadline,
            adminUrl,
          }),
        }),
    });

    await systemComment(
      task.id,
      client.id,
      counts
        ? [
            "בוטל אוטומטית בהשעיה באפליקציה:",
            "- כל ההתחברויות נותקו",
            `- passkeys שהוסרו: ${counts.passkeys}`,
            `- חלונות אימות שנסגרו: ${counts.stepUpGrants}`,
            `- חיבורי Claude שבוטלו: ${counts.claudeGrants}`,
            `- קישורי חתימה שבוטלו: ${counts.signLinks}`,
          ].join("\n")
        : "ההתחברויות נותקו, אבל הסרת ה-passkeys וחיבורי Claude נכשלה. יש לבדוק ביומן הפעולות ולבצע ידנית.",
    );
    return task.id;
  } catch (err) {
    await recordFailure(actor, subject.id, "offboarding_task", err);
    return null;
  }
}

async function openLifecycleTaskFor(userId: string, kind: EmployeeLifecycleKind) {
  return prisma.task.findFirst({
    where: { subjectUserId: userId, lifecycleKind: kind, deletedAt: null, parentId: null, status: { in: OPEN_STATUSES } },
    orderBy: { createdAt: "desc" },
    select: { id: true, clientId: true },
  });
}

/// The open lifecycle task about this person, of one kind, or null.
export async function openLifecycleTaskId(userId: string, kind: EmployeeLifecycleKind): Promise<string | null> {
  const task = await openLifecycleTaskFor(userId, kind);
  return task?.id ?? null;
}

/// Called after a signed PDF arrives through a personal upload link.
/// A note on the matching lifecycle task, and nothing closed: the PDF
/// still has to be checked (code, signature) and recorded.
export async function onSignedPdfUploaded(
  userId: string,
  kind: "CONFIDENTIALITY" | "DELETION_DECLARATION",
  documentId: string,
  codeFound: boolean
): Promise<void> {
  try {
    const task = await openLifecycleTaskFor(userId, kind === "CONFIDENTIALITY" ? "ONBOARDING" : "OFFBOARDING");
    if (!task) return;
    const lines = [`הועלה PDF חתום (documentId ${documentId}), ממתין לבדיקת קוד וחתימה ורישום.`];
    if (!codeFound) lines.push("הקוד לא נמצא בטקסט.");
    await systemComment(task.id, task.clientId, lines.join(" "));
  } catch (err) {
    await recordFailure(null, userId, "pdf_uploaded_hook", err);
  }
}

/// Called after the APP confidentiality signature is recorded.
///
/// Step 4 is "the undertaking approved in the app AND a passkey set up".
/// The signature alone is half of it, so the step closes here only when
/// the person already has a passkey. In the ordinary order of things they
/// do not yet (the profile page where a passkey is added sits behind the
/// very gate they just passed), so the step stays open with a comment
/// saying which half is done, and the agent or the owner closes it once
/// the passkey exists (onPasskeyRegistered below does exactly that).
/// Closing it on the signature alone would mark the passkey done when
/// nobody set one.
export async function onConfidentialitySigned(userId: string): Promise<void> {
  try {
    const task = await openLifecycleTaskFor(userId, "ONBOARDING");
    if (!task) return;

    const passkeys = await prisma.passkey.count({ where: { userId } });
    const step = await prisma.task.findFirst({
      where: { parentId: task.id, title: ONBOARDING_STEPS[ONBOARDING_SIGN_STEP], deletedAt: null, status: { in: OPEN_STATUSES } },
      select: { id: true },
    });

    if (step && passkeys > 0) {
      await completeStepAsSystem(step.id, "confidentiality_signed_with_passkey");
    }

    await systemComment(
      task.id,
      task.clientId,
      passkeys > 0
        ? `ההתחייבות לסודיות (${CURRENT_AGREEMENTS.CONFIDENTIALITY}) אושרה באפליקציה, ו-passkey כבר מוגדר. השלב נסגר.`
        : `ההתחייבות לסודיות (${CURRENT_AGREEMENTS.CONFIDENTIALITY}) אושרה באפליקציה. ה-passkey עדיין לא הוגדר, ולכן השלב נשאר פתוח.`,
    );
  } catch (err) {
    await recordFailure(null, userId, "onboarding_sign_hook", err);
  }
}

/// Called after a passkey is registered: the other half of step 4. Closes
/// the step only when the in-app signature on the current version is
/// already there, so whichever half comes second closes it.
export async function onPasskeyRegistered(userId: string): Promise<void> {
  try {
    if (!(await hasSignedCurrent(userId, "CONFIDENTIALITY", "APP"))) return;
    const task = await openLifecycleTaskFor(userId, "ONBOARDING");
    if (!task) return;
    const step = await prisma.task.findFirst({
      where: { parentId: task.id, title: ONBOARDING_STEPS[ONBOARDING_SIGN_STEP], deletedAt: null, status: { in: OPEN_STATUSES } },
      select: { id: true },
    });
    if (!step) return;
    if (await completeStepAsSystem(step.id, "passkey_registered_after_signature")) {
      await systemComment(task.id, task.clientId, "הוגדר passkey, וההתחייבות לסודיות כבר אושרה באפליקציה. השלב נסגר.");
    }
  } catch (err) {
    await recordFailure(null, userId, "onboarding_passkey_hook", err);
  }
}

/// Called after a signed PDF is recorded (the MCP tool record_pdf_signature).
///
/// Confidentiality: step 5 ("the signed PDF received, version checked,
/// filed") closes once both channels exist on the current version. With
/// only the PDF, the in-app approval is still missing and step 4 says so,
/// so step 5 waits too rather than reading as the end of the signatures.
/// Deletion declaration: a note on the open offboarding task, and nothing
/// closed, exactly as for the link.
export async function onPdfSignatureRecorded(
  userId: string,
  kind: "CONFIDENTIALITY" | "DELETION_DECLARATION",
  agreementId: string
): Promise<void> {
  try {
    if (kind === "DELETION_DECLARATION") {
      const task = await openLifecycleTaskFor(userId, "OFFBOARDING");
      if (!task) return;
      await systemComment(
        task.id,
        task.clientId,
        `הצהרת המחיקה (${CURRENT_AGREEMENTS.DELETION_DECLARATION}) התקבלה חתומה ב-PDF ונרשמה. מזהה החתימה: ${agreementId}.`,
      );
      return;
    }

    if (!(await hasSignedCurrent(userId, "CONFIDENTIALITY", "APP"))) return;
    const task = await openLifecycleTaskFor(userId, "ONBOARDING");
    if (!task) return;
    const step = await prisma.task.findFirst({
      where: { parentId: task.id, title: ONBOARDING_STEPS[ONBOARDING_PDF_STEP], deletedAt: null, status: { in: OPEN_STATUSES } },
      select: { id: true },
    });
    if (!step) return;
    if (await completeStepAsSystem(step.id, "confidentiality_pdf_recorded")) {
      await systemComment(
        task.id,
        task.clientId,
        `ההתחייבות לסודיות (${CURRENT_AGREEMENTS.CONFIDENTIALITY}) חתומה בשני הערוצים: באפליקציה וב-PDF. השלב נסגר.`,
      );
    }
  } catch (err) {
    await recordFailure(null, userId, "pdf_signature_hook", err);
  }
}

/// Called after a deletion declaration is signed through its link. Notes
/// it on the open offboarding task and closes nothing: filing it and
/// closing the task are a person's call.
export async function onDeletionDeclarationSigned(userId: string, agreementId: string): Promise<void> {
  try {
    const task = await openLifecycleTaskFor(userId, "OFFBOARDING");
    if (!task) return;
    await systemComment(
      task.id,
      task.clientId,
      `הצהרת המחיקה (${CURRENT_AGREEMENTS.DELETION_DECLARATION}) נחתמה בקישור. מזהה החתימה: ${agreementId}. נשאר לתייק ולבדוק את שאר השלבים.`,
    );
  } catch (err) {
    await recordFailure(null, userId, "offboarding_sign_hook", err);
  }
}
