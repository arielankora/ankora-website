import "server-only";
import type { ProcessCheckOutcome, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertCan } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { findSecrets } from "@/lib/secret-scan";
import { localDateKey, localDateTimeToUtc, TIMEZONE } from "@/lib/timezone";
import { readSteps } from "@/lib/process-rules";
import { checkDueKey, checkEveryText, checkState, isRoutine, type CheckState } from "@/lib/process-checks";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { assertClientAccess } from "@/lib/app-domain/client-sources";
import { openCheckIssueTask } from "@/lib/app-domain/process-runs";

// Org brain, phase 1: the routine (claude/org-brain-spec-2026-10-12.md,
// 3.8). An ongoing process (CONTINUOUS) opens no tasks: collecting SaaS
// invoices, keeping the books current, watching the bank. Its owner sees
// it in their routine, on the home screen, and when it has a check every
// N days, they are reminded when it is due and write down what they found.
//
// A check is a record, not a task. "Looked, all fine" is a line in the
// history and nothing else. "Looked, two invoices are stuck" says what,
// and opens a task for it, because that is work now.

export const CHECK_DUE = "process.check_due";

const MAX_NOTE = 1000;

export type Routine = {
  id: string;
  clientId: string;
  clientName: string;
  code: string;
  title: string;
  checkText: string | null;
  checkEveryDays: number | null;
  checkEvery: string | null;
  lastCheckedAt: Date | null;
  dueKey: string | null;
  state: CheckState | null;
  /// The person is the backup, not the owner: shown, but the owner is the
  /// one reminded.
  asBackup: boolean;
  /// The approved procedure's steps: what the routine consists of.
  steps: string[];
};

const ORDER: Record<CheckState, number> = { OVERDUE: 0, DUE: 1, LATER: 2 };

/// The ongoing processes this person owns or backs up, on clients they
/// can reach, most urgent check first.
export async function listMyRoutines(actor: User, now = new Date()): Promise<Routine[]> {
  const clients = await listAccessibleClients(actor);
  if (clients.length === 0) return [];
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  const rows = await prisma.process.findMany({
    where: {
      deletedAt: null,
      clientId: { in: clients.map((c) => c.id) },
      triggerKinds: { has: "CONTINUOUS" },
      status: { in: ["ACTIVE", "DRAFT"] },
      OR: [{ ownerId: actor.id }, { backupOwnerId: actor.id }],
    },
    include: { versions: { where: { status: "APPROVED" }, take: 1, select: { steps: true } } },
  });
  const todayKey = localDateKey(now, TIMEZONE);
  return rows
    .map((p) => {
      const dueKey = checkDueKey({ checkEveryDays: p.checkEveryDays, lastCheckedKey: p.lastCheckedAt ? localDateKey(p.lastCheckedAt, TIMEZONE) : null }, todayKey);
      return {
        id: p.id,
        clientId: p.clientId,
        clientName: clientName.get(p.clientId) ?? "",
        code: p.code,
        title: p.title,
        checkText: p.checkText,
        checkEveryDays: p.checkEveryDays,
        checkEvery: p.checkEveryDays ? checkEveryText(p.checkEveryDays) : null,
        lastCheckedAt: p.lastCheckedAt,
        dueKey,
        state: dueKey ? checkState(dueKey, todayKey) : null,
        asBackup: p.ownerId !== actor.id,
        steps: p.versions[0] ? readSteps(p.versions[0].steps).map((s) => s.title) : [],
      };
    })
    .sort((a, b) => {
      const sa = a.state ? ORDER[a.state] : 3;
      const sb = b.state ? ORDER[b.state] : 3;
      if (sa !== sb) return sa - sb;
      if (a.dueKey && b.dueKey && a.dueKey !== b.dueKey) return a.dueKey < b.dueKey ? -1 : 1;
      return `${a.clientName} ${a.code}`.localeCompare(`${b.clientName} ${b.code}`, "he");
    });
}

export type CheckInput = { outcome: ProcessCheckOutcome; note?: string | null };

/// Writes down a check. Anyone on the client may (the backup covers when
/// the owner is away); an issue needs a sentence, and opens a task for
/// the person who found it.
export async function recordProcessCheck(actor: User, processId: string, input: CheckInput, now = new Date()) {
  assertCan(actor.role, "time_entry.create_self");
  const process = await prisma.process.findUnique({ where: { id: processId } });
  if (!process || process.deletedAt) throw new Error("התהליך לא נמצא.");
  await assertClientAccess(actor, process.clientId);
  if (!isRoutine(process)) throw new Error("בדיקה נרשמת לתהליך שוטף שלא הושהה ולא בוטל.");
  if (input.outcome !== "OK" && input.outcome !== "ISSUE") throw new Error("מה נמצא בבדיקה?");
  const note = input.note?.trim() || null;
  if (input.outcome === "ISSUE" && !note) throw new Error("כשנמצאה בעיה, כותבים מה נמצא.");
  if (note && note.length > MAX_NOTE) throw new Error(`עד ${MAX_NOTE} תווים.`);
  if (note && findSecrets(note).length) throw new Error("יש כאן סיסמה, מפתח או מספר כרטיס. סודות נשמרים בכספת, לא בתיק.");

  const task =
    input.outcome === "ISSUE"
      ? await openCheckIssueTask({
          processId,
          clientId: process.clientId,
          code: process.code,
          title: process.title,
          note: note!,
          assigneeId: actor.id,
          categoryId: process.categoryId,
          day: new Date(`${localDateKey(now, TIMEZONE)}T00:00:00Z`),
        })
      : null;
  const check = await prisma.processCheck.create({
    data: { processId, clientId: process.clientId, checkedById: actor.id, outcome: input.outcome, note, taskId: task?.id ?? null, createdAt: now },
  });
  await prisma.process.update({ where: { id: processId }, data: { lastCheckedAt: now } });
  await recordAudit({
    actorId: actor.id,
    action: "process.check",
    entityType: "Process",
    entityId: processId,
    clientId: process.clientId,
    after: { code: process.code, outcome: input.outcome, note, taskId: task?.id ?? null },
  });
  return { check, task };
}

/// The last checks of a process, newest first, for its card.
export async function listProcessChecks(actor: User, processId: string, take = 5) {
  const process = await prisma.process.findUnique({ where: { id: processId }, select: { clientId: true } });
  if (!process) return [];
  await assertClientAccess(actor, process.clientId);
  const rows = await prisma.processCheck.findMany({ where: { processId }, orderBy: { createdAt: "desc" }, take });
  const ids = [...new Set(rows.map((r) => r.checkedById).filter((x): x is string => !!x))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const name = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((r) => ({ ...r, checkedByName: r.checkedById ? name.get(r.checkedById) ?? null : null }));
}

/// The daily job: a check that is due today or late reminds the owner (the
/// backup when there is no owner), once per due day. A process nobody
/// owns reminds nobody: that is a gap the card already shows.
export async function notifyDueProcessChecks(now = new Date()): Promise<{ notified: number }> {
  const rows = await prisma.process.findMany({
    where: { deletedAt: null, triggerKinds: { has: "CONTINUOUS" }, status: { in: ["ACTIVE", "DRAFT"] }, checkEveryDays: { not: null } },
    select: { id: true, clientId: true, code: true, title: true, checkText: true, checkEveryDays: true, lastCheckedAt: true, ownerId: true, backupOwnerId: true },
  });
  const todayKey = localDateKey(now, TIMEZONE);
  let notified = 0;
  for (const p of rows) {
    const userId = p.ownerId ?? p.backupOwnerId;
    if (!userId) continue;
    const dueKey = checkDueKey({ checkEveryDays: p.checkEveryDays, lastCheckedKey: p.lastCheckedAt ? localDateKey(p.lastCheckedAt, TIMEZONE) : null }, todayKey);
    if (!dueKey || checkState(dueKey, todayKey) === "LATER") continue;
    const title = `הגיע זמן הבדיקה: ${p.code} ${p.title}`.slice(0, 200);
    // Once per due day: a reminder already sent since the check fell due
    // is the same reminder. The next one comes when the next check does.
    const since = localDateTimeToUtc(dueKey, "00:00", TIMEZONE);
    const sent = await prisma.notification.count({ where: { userId, type: CHECK_DUE, entityId: p.clientId, title, createdAt: { gte: since } } });
    if (sent) continue;
    await prisma.notification.create({
      data: {
        userId,
        type: CHECK_DUE,
        title,
        body: [p.checkText ?? "בדיקה שוטפת", p.lastCheckedAt ? `נבדק לאחרונה ב-${localDateKey(p.lastCheckedAt, TIMEZONE).split("-").reverse().join(".")}` : "עוד לא נבדק"].join(". ") + ".",
        entityType: "ClientProcesses",
        entityId: p.clientId,
      },
    });
    notified++;
  }
  return { notified };
}
