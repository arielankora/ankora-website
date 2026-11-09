import "server-only";
import type { User, VendorDetection } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/app-auth/audit";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { openProcessRun } from "@/lib/app-domain/process-runs";
import { internalClientIds } from "@/lib/app-domain/internal-client";
import { resolveInternalClient } from "@/lib/app-domain/employee-lifecycle";
import { appBaseUrl } from "@/lib/email-templates";
import { addBusinessDays } from "@/lib/business-calendar";
import { localDateKey, TIMEZONE } from "@/lib/timezone";
import { detectVendorSignal, knownVendorsFromSite, vendorKey } from "@/lib/vendor-detection";

/// P8 (הוספת תת-מעבד חדש), 3.11.2026. The stranger test on P8 found that
/// nothing noticed a new vendor being connected: it depended on Ariel or
/// ops@ remembering to open the subprocessor task, and in Unipile the
/// vendor was connected before the process started.
///
/// This is the noticing. Every task that is created or edited, and every
/// plan that is saved, is read here. When the text looks like connecting a
/// new vendor to the product, one row is recorded and a question is put:
/// to Claude in the tool's answer, and to the people on the task screen.
/// The answer opens the P8 run, or says it is not a vendor, or notes a new
/// channel on the vendor's existing run. Nobody answering for a business
/// day opens the run anyway (openOverdueVendorRuns, on the daily cron):
/// a question nobody answers is the gap this was built to close.
///
/// Scope (Ariel, 3.11.2026): only the app and the service Ankora gives
/// clients, and client data. So on the internal file only product work is
/// read (the category below); marketing, sales and Ankora's back office
/// are not. On a client's file every task is read, because there Ankora
/// connecting a tool touches that client's data by definition.
///
/// Never in the way: a failure here is logged and the task is saved all
/// the same (checkVendorSignalSafely).

/// The internal-file category whose tasks are product work.
export const PRODUCT_CATEGORY_NAME = "פיתוח מוצר";
/// The internal process the run is opened from. By code, as everywhere
/// the team refers to it; P8_PROCESS_CODE overrides it.
export function subprocessorProcessCode(): string {
  return process.env.P8_PROCESS_CODE?.trim() || "P8";
}
/// Nobody answered for this many business days: the run opens anyway.
export const AUTO_OPEN_AFTER_BUSINESS_DAYS = 1;

export const VENDOR_CHECK_QUESTION =
  "נראה שהמשימה מחברת ספק חדש לאפליקציה או לשירות ללקוחות. האם הספק ייגש למידע של לקוחות ונדרשת ריצת P8 (הוספת תת-מעבד)? שאל את המשתמש, ואז קרא ל-decide_vendor_check עם ההחלטה.";

export type VendorCheck = {
  detectionId: string;
  vendor: string | null;
  matched: string;
  question: string;
};

export function toVendorCheck(d: Pick<VendorDetection, "id" | "vendorName" | "matched">): VendorCheck {
  return { detectionId: d.id, vendor: d.vendorName, matched: d.matched, question: VENDOR_CHECK_QUESTION };
}

async function p8Process() {
  const internal = await resolveInternalClient();
  if (!internal) return null;
  return prisma.process.findFirst({
    where: { clientId: internal.id, code: subprocessorProcessCode(), deletedAt: null },
    select: { id: true, code: true, title: true, clientId: true, ownerId: true },
  });
}

/// Vendors that need no new run: the security page's register, and every
/// vendor a run was already opened for.
async function knownVendors(): Promise<{ names: string[]; runByKey: Map<string, string> }> {
  const opened = await prisma.vendorDetection.findMany({
    where: { status: "OPENED", vendorSlug: { not: null }, runTaskId: { not: null } },
    select: { vendorName: true, vendorSlug: true, runTaskId: true },
    orderBy: { createdAt: "asc" },
  });
  const runByKey = new Map<string, string>();
  for (const o of opened) if (o.vendorSlug && o.runTaskId && !runByKey.has(o.vendorSlug)) runByKey.set(o.vendorSlug, o.runTaskId);
  return { names: [...knownVendorsFromSite(), ...opened.map((o) => o.vendorName!).filter(Boolean)], runByKey };
}

/// Reads one task (and, when given, a plan being saved on it) and records
/// what it finds. Returns the open question, if there is one.
///
/// A task is asked about once: a second edit, or a plan saved later, finds
/// the row already there and returns its question while it is pending.
export async function checkVendorSignal(taskId: string, extraText?: string | null): Promise<VendorCheck | null> {
  const task = await prisma.task.findFirst({
    where: { id: taskId, deletedAt: null },
    select: {
      id: true,
      parentId: true,
      clientId: true,
      title: true,
      description: true,
      processId: true,
      status: true,
      category: { select: { name: true } },
      client: { select: { id: true, isInternal: true } },
      vendorDetection: true,
    },
  });
  if (!task || task.parentId) return null;
  if (task.vendorDetection) return task.vendorDetection.status === "PENDING" ? toVendorCheck(task.vendorDetection) : null;
  if (task.status === "DONE" || task.status === "ARCHIVED") return null;

  // The text first: it costs nothing, and almost every task has no signal
  // at all. Whether there is one does not depend on which names are known
  // (that only decides new or existing), so the site's list is enough to
  // stop here without a single further query.
  const text = [task.title, task.description, extraText].filter(Boolean).join("\n");
  if (!detectVendorSignal(text, knownVendorsFromSite())) return null;

  const p8 = await p8Process();
  // A P8 run talks about vendors all day; it is not a new one.
  if (p8 && task.processId === p8.id) return null;

  const internal = await internalClientIds([task.client]);
  if (internal.has(task.clientId) && task.category?.name !== PRODUCT_CATEGORY_NAME) return null;

  const known = await knownVendors();
  const signal = detectVendorSignal(text, known.names);
  if (!signal) return null;

  if (signal.existingVendor) {
    // A known vendor. With a run of its own: a new channel, noted there.
    // Without one (it is on the security page from before P8): nothing to
    // do, and nothing worth asking.
    const runTaskId = known.runByKey.get(vendorKey(signal.existingVendor));
    if (!runTaskId) return null;
    const row = await prisma.vendorDetection.create({
      data: {
        sourceTaskId: task.id,
        clientId: task.clientId,
        vendorName: signal.existingVendor,
        vendorSlug: vendorKey(signal.existingVendor),
        matched: signal.matched,
        status: "EXISTING",
        runTaskId,
        decidedAt: new Date(),
      },
    });
    await noteOnRun(runTaskId, task.id, task.title, signal.existingVendor, null);
    await recordAudit({
      actorId: null,
      action: "vendor_detection.existing",
      entityType: "Task",
      entityId: task.id,
      clientId: task.clientId,
      after: { detectionId: row.id, vendor: signal.existingVendor, runTaskId },
    });
    return null;
  }

  const row = await prisma.vendorDetection.create({
    data: {
      sourceTaskId: task.id,
      clientId: task.clientId,
      vendorName: signal.vendor,
      vendorSlug: signal.vendor ? vendorKey(signal.vendor) : null,
      matched: signal.matched,
    },
  });
  await recordAudit({
    actorId: null,
    action: "vendor_detection.create",
    entityType: "Task",
    entityId: task.id,
    clientId: task.clientId,
    after: { detectionId: row.id, vendor: signal.vendor, matched: signal.matched },
  });
  return toVendorCheck(row);
}

/// The same, for the write paths: a task is saved whatever happens here.
export async function checkVendorSignalSafely(taskId: string, extraText?: string | null): Promise<VendorCheck | null> {
  try {
    return await checkVendorSignal(taskId, extraText);
  } catch (err) {
    console.error("[vendor-detection] check failed", taskId, err);
    return null;
  }
}

/// The open question on a task, for the task screen and the tools.
export async function pendingVendorCheck(taskId: string): Promise<VendorCheck | null> {
  const row = await prisma.vendorDetection.findFirst({ where: { sourceTaskId: taskId, status: "PENDING" } });
  return row ? toVendorCheck(row) : null;
}

async function noteOnRun(runTaskId: string, sourceTaskId: string, sourceTitle: string, vendor: string, authorId: string | null) {
  const base = appBaseUrl();
  await prisma.taskComment.create({
    data: {
      taskId: runTaskId,
      authorId,
      body: `ערוץ או שימוש חדש אצל ${vendor}, מהמשימה "${sourceTitle}": ${base}/app/tasks/${sourceTaskId}\nלבדוק את הכלל של P8 שלב 5: בפיילוט מחברים קודם רק ערוץ בלי מידע של לקוחות, עד שההודעה ללקוחות יוצאת.`,
    },
  });
}

export type VendorDecision = "OPEN_RUN" | "NOT_A_VENDOR";

export const VENDOR_DECIDED_MESSAGE = "כבר הוחלט על הזיהוי הזה.";
export const VENDOR_NAME_REQUIRED_MESSAGE = "כדי לפתוח ריצת P8 צריך את שם הספק.";
export const NO_P8_MESSAGE = "לא נמצא תהליך P8 בתיק הפנימי, או שאין לו נוהל מאושר.";

/// How a check that is no longer pending was decided, or null while it
/// still waits (or does not exist). 9.11.2026: decide_vendor_check on a
/// check someone had already answered in the app threw
/// VENDOR_DECIDED_MESSAGE, and the connector reported it as an unexpected
/// server error, twice (3.11 and 9.11) on the same check. The tool now
/// reads this first and says the check is already closed, and how.
export async function decidedVendorCheck(detectionId: string): Promise<{
  status: Exclude<VendorDetection["status"], "PENDING">;
  vendor: string | null;
  decidedAt: Date | null;
  decidedBy: string | null;
  autoOpened: boolean;
  runUrl: string | null;
} | null> {
  const row = await prisma.vendorDetection.findUnique({
    where: { id: detectionId },
    select: { status: true, vendorName: true, decidedAt: true, autoOpened: true, runTaskId: true, decidedBy: { select: { name: true } } },
  });
  if (!row || row.status === "PENDING") return null;
  return {
    status: row.status,
    vendor: row.vendorName,
    decidedAt: row.decidedAt,
    decidedBy: row.decidedBy?.name ?? null,
    autoOpened: row.autoOpened,
    runUrl: row.runTaskId ? `${appBaseUrl()}/app/tasks/${row.runTaskId}` : null,
  };
}

async function openRunFor(detection: VendorDetection, vendor: string, actorId: string | null) {
  const p8 = await p8Process();
  if (!p8) throw new Error(NO_P8_MESSAGE);
  const source = await prisma.task.findUnique({ where: { id: detection.sourceTaskId }, select: { id: true, title: true } });
  const base = appBaseUrl();
  const sourceLine = source ? `נפתחה מזיהוי אוטומטי במשימה "${source.title}": ${base}/app/tasks/${source.id}` : "נפתחה מזיהוי אוטומטי.";
  const run = await openProcessRun({
    processId: p8.id,
    occurrence: new Date(),
    actorId,
    fallbackAssigneeId: actorId,
    titleSuffix: vendor,
    descriptionPrefix: `**ספק:** ${vendor}\n${sourceLine}`,
  });
  if (!run) throw new Error(NO_P8_MESSAGE);
  if (source) {
    await prisma.taskComment.create({
      data: { taskId: source.id, authorId: actorId, body: `נפתחה ריצת ${p8.code} (הוספת תת-מעבד) לספק ${vendor}: ${base}/app/tasks/${run.id}` },
    });
  }
  return run;
}

/// A person (or Claude, after asking one) answers the question.
export async function decideVendorCheck(
  actor: User,
  detectionId: string,
  decision: VendorDecision,
  vendorName?: string | null
): Promise<{ status: VendorDetection["status"]; runTaskId: string | null; runUrl: string | null; vendor: string | null }> {
  const row = await prisma.vendorDetection.findUnique({ where: { id: detectionId } });
  if (!row) throw new Error("הזיהוי לא נמצא.");
  const accessible = await listAccessibleClients(actor);
  if (!accessible.some((c) => c.id === row.clientId)) throw new Error("אין לך גישה למשימה הזו.");
  if (row.status !== "PENDING") throw new Error(VENDOR_DECIDED_MESSAGE);

  const vendor = vendorName?.trim() || row.vendorName;
  const now = new Date();

  if (decision === "NOT_A_VENDOR") {
    const after = await prisma.vendorDetection.update({
      where: { id: row.id },
      data: { status: "NOT_A_VENDOR", decidedById: actor.id, decidedAt: now },
    });
    await recordAudit({
      actorId: actor.id,
      action: "vendor_detection.dismiss",
      entityType: "Task",
      entityId: row.sourceTaskId,
      clientId: row.clientId,
      after: { detectionId: row.id, vendor },
    });
    return { status: after.status, runTaskId: null, runUrl: null, vendor };
  }

  if (!vendor) throw new Error(VENDOR_NAME_REQUIRED_MESSAGE);
  const key = vendorKey(vendor);
  // The same vendor already has a run (from another task): note it there.
  const existing = await prisma.vendorDetection.findFirst({
    where: { status: "OPENED", vendorSlug: key, runTaskId: { not: null } },
    select: { runTaskId: true },
  });
  if (existing?.runTaskId) {
    const source = await prisma.task.findUnique({ where: { id: row.sourceTaskId }, select: { title: true } });
    await noteOnRun(existing.runTaskId, row.sourceTaskId, source?.title ?? "", vendor, actor.id);
    await prisma.vendorDetection.update({
      where: { id: row.id },
      data: { status: "EXISTING", vendorName: vendor, vendorSlug: key, runTaskId: existing.runTaskId, decidedById: actor.id, decidedAt: now },
    });
    await recordAudit({
      actorId: actor.id,
      action: "vendor_detection.existing",
      entityType: "Task",
      entityId: row.sourceTaskId,
      clientId: row.clientId,
      after: { detectionId: row.id, vendor, runTaskId: existing.runTaskId },
    });
    return { status: "EXISTING", runTaskId: existing.runTaskId, runUrl: `${appBaseUrl()}/app/tasks/${existing.runTaskId}`, vendor };
  }

  const run = await openRunFor(row, vendor, actor.id);
  await prisma.vendorDetection.update({
    where: { id: row.id },
    data: { status: "OPENED", vendorName: vendor, vendorSlug: key, runTaskId: run.id, decidedById: actor.id, decidedAt: now },
  });
  await recordAudit({
    actorId: actor.id,
    action: "vendor_detection.open_run",
    entityType: "Task",
    entityId: row.sourceTaskId,
    clientId: row.clientId,
    after: { detectionId: row.id, vendor, runTaskId: run.id },
  });
  return { status: "OPENED", runTaskId: run.id, runUrl: `${appBaseUrl()}/app/tasks/${run.id}`, vendor };
}

/// The daily job: a question nobody answered for a business day opens the
/// run. A detection without a vendor name opens it as "ספק לא מזוהה", and
/// the run's first step (classification) is where a person names it.
export async function openOverdueVendorRuns(now: Date = new Date()): Promise<{ opened: number; failed: number }> {
  const todayKey = localDateKey(now, TIMEZONE);
  // A task dropped (archived) or deleted while its question waited is not
  // a vendor being connected: nothing opens for it. It stays pending, and
  // reopening the task brings the question back. A task finished (DONE)
  // still opens: the work, vendor included, most likely happened.
  // Filtered in the query rather than skipped in the loop, so rows that
  // will never open cannot crowd the 50 out of newer ones.
  const pending = await prisma.vendorDetection.findMany({
    where: { status: "PENDING", sourceTask: { deletedAt: null, status: { not: "ARCHIVED" } } },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  let opened = 0;
  let failed = 0;
  for (const row of pending) {
    const due = addBusinessDays(localDateKey(row.createdAt, TIMEZONE), AUTO_OPEN_AFTER_BUSINESS_DAYS, "IL");
    if (todayKey <= due) continue;
    try {
      const vendor = row.vendorName ?? "ספק לא מזוהה";
      const run = await openRunFor(row, vendor, null);
      await prisma.vendorDetection.update({
        where: { id: row.id },
        data: { status: "OPENED", vendorName: vendor, vendorSlug: row.vendorName ? vendorKey(row.vendorName) : null, runTaskId: run.id, autoOpened: true, decidedAt: now },
      });
      await recordAudit({
        actorId: null,
        action: "vendor_detection.auto_open",
        entityType: "Task",
        entityId: row.sourceTaskId,
        clientId: row.clientId,
        after: { detectionId: row.id, vendor, runTaskId: run.id },
      });
      opened++;
    } catch (err) {
      console.error("[vendor-detection] auto open failed", row.id, err);
      failed++;
    }
  }
  return { opened, failed };
}
