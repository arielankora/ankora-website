import "server-only";
import { prisma } from "@/lib/prisma";
import { assertCan } from "@/lib/app-auth/permissions";
import { appBaseUrl } from "@/lib/email-templates";
import { localDateKey } from "@/lib/timezone";
import { getAgreementStatus } from "@/lib/app-domain/agreements";
import { OPEN_STATUSES } from "@/lib/app-domain/tasks";
import { calendarDaysSince } from "@/lib/mcp/serialize";

// Employee lifecycle, read side (15.10.2026): one person's onboarding or
// offboarding state in one answer, for the Claude agents that run those
// processes through the MCP server (get_employee_status).
//
// What it deliberately leaves out: the personal email (only whether one
// is on file), IPs, browsers, content hashes, passkey details beyond a
// count, and anything from the password or lockout columns. An agent
// needs to know whether a step is done, not the evidence behind it, and
// everything here lands in a third-party model's context.

export class EmployeeNotFoundError extends Error {
  constructor() {
    super("No Ankora staff member with that id.");
    this.name = "EmployeeNotFoundError";
  }
}

export async function getEmployeeStatus(actor: { role: Parameters<typeof assertCan>[0] }, userId: string, now: Date = new Date()) {
  // The same gate as the team tools: a colleague's state is theirs.
  assertCan(actor.role, "time_entry.edit_others");

  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null, role: { not: "CLIENT_USER" } },
    select: { id: true, name: true, email: true, role: true, status: true, lastLoginAt: true, lastSeenAt: true, personalEmail: true },
  });
  if (!user) throw new EmployeeNotFoundError();

  const [agreements, passkeyCount, tasks] = await Promise.all([
    getAgreementStatus(user.id),
    prisma.passkey.count({ where: { userId: user.id } }),
    prisma.task.findMany({
      where: { subjectUserId: user.id, deletedAt: null, parentId: null, status: { in: OPEN_STATUSES } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        title: true,
        lifecycleKind: true,
        dueDate: true,
        subtasks: { where: { deletedAt: null }, orderBy: { createdAt: "asc" }, select: { title: true, status: true } },
      },
    }),
  ]);

  const base = appBaseUrl();
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    daysSinceLogin: calendarDaysSince(user.lastLoginAt, now),
    lastSeenAt: user.lastSeenAt ? user.lastSeenAt.toISOString() : null,
    daysSinceSeen: calendarDaysSince(user.lastSeenAt, now),
    personalEmailOnFile: !!user.personalEmail,
    passkeyCount,
    agreements: agreements.map((a) => ({
      kind: a.kind,
      currentVersion: a.currentVersion,
      appSignedCurrent: a.app,
      emailPdfSignedCurrent: a.emailPdf,
      app: a.appLatest ? { version: a.appLatest.version, signedAt: a.appLatest.signedAt.toISOString() } : null,
      emailPdf: a.emailPdfLatest ? { version: a.emailPdfLatest.version, signedAt: a.emailPdfLatest.signedAt.toISOString() } : null,
    })),
    lifecycleTasks: tasks.map((t) => {
      const steps = t.subtasks.filter((s) => s.status !== "ARCHIVED");
      return {
        taskId: t.id,
        kind: t.lifecycleKind,
        title: t.title,
        url: `${base}/app/tasks/${t.id}`,
        due: t.dueDate ? localDateKey(t.dueDate, "UTC") : null,
        stepsDone: steps.filter((s) => s.status === "DONE").length,
        stepsTotal: steps.length,
        openSteps: steps.filter((s) => s.status !== "DONE").map((s) => s.title),
      };
    }),
    adminPageUrl: `${base}/app/users/${user.id}`,
  };
}
