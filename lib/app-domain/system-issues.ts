import "server-only";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { DomainError } from "@/lib/domain-error";
import { EMAIL_SUBJECT_MARK } from "@/lib/email";

/// What the "תקלות מערכת" screen and the connector read and change
/// (27.11.2026, silent failures plan, stage 1b). The issues themselves are
/// written only by reportIssue (lib/system-issues.ts).
///
/// Admins only: the same people the alerts go to. A person may close an
/// issue and leave a note; Claude may leave a note and a pull request link
/// (annotateSystemIssue), never close one: closing says "this is handled",
/// and that is a person's call.

/// The nightly jobs vercel.json schedules, in the order they run, so the
/// screen can show a job that has no run at all.
export const CRON_JOBS = ["scheduled-reports", "comms-recordings", "vault-rewrap", "claude-usage-retention", "system-health", "alerts-reconcile", "mail-waits"] as const;

const RESOLVED_SHOWN_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

function assertCanManage(actor: Pick<User, "role">) {
  if (!can(actor.role, "system_issue.manage")) {
    throw new DomainError("systemIssues.forbidden", "רק מנהלים רואים את תקלות המערכת.");
  }
}

export type SystemIssueRow = {
  id: string;
  area: string;
  key: string;
  title: string;
  detail: string | null;
  severity: "CRITICAL" | "WARNING";
  status: "OPEN" | "RESOLVED";
  count: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastAlertedAt: Date | null;
  resolvedAt: Date | null;
  note: string | null;
  prUrl: string | null;
};

const SELECT = {
  id: true,
  area: true,
  key: true,
  title: true,
  detail: true,
  severity: true,
  status: true,
  count: true,
  firstSeenAt: true,
  lastSeenAt: true,
  lastAlertedAt: true,
  resolvedAt: true,
  note: true,
  prUrl: true,
} as const;

/// Open issues, most recent first, and the ones resolved lately.
/// `sinceHours` narrows both to issues seen in that window (the nightly
/// analysis reads the last 24 hours).
export async function listSystemIssues(
  actor: Pick<User, "role">,
  opts: { status?: "OPEN" | "RESOLVED" | "ALL"; area?: string; sinceHours?: number; now?: Date } = {},
): Promise<{ open: SystemIssueRow[]; resolved: SystemIssueRow[] }> {
  assertCanManage(actor);
  const now = opts.now ?? new Date();
  const status = opts.status ?? "ALL";
  const seen = opts.sinceHours ? { lastSeenAt: { gte: new Date(now.getTime() - opts.sinceHours * 60 * 60 * 1000) } } : {};
  const area = opts.area ? { area: opts.area } : {};
  const [open, resolved] = await Promise.all([
    status === "RESOLVED"
      ? []
      : prisma.systemIssue.findMany({ where: { status: "OPEN", ...seen, ...area }, select: SELECT, orderBy: [{ severity: "asc" }, { lastSeenAt: "desc" }], take: 200 }),
    status === "OPEN"
      ? []
      : prisma.systemIssue.findMany({
          where: { status: "RESOLVED", resolvedAt: { gte: new Date(now.getTime() - RESOLVED_SHOWN_DAYS * DAY_MS) }, ...seen, ...area },
          select: SELECT,
          orderBy: { resolvedAt: "desc" },
          take: 100,
        }),
  ]);
  return { open, resolved };
}

export type CronJobHealth = {
  job: string;
  lastRun: { startedAt: Date; finishedAt: Date | null; ok: boolean | null; failedSteps: string[] } | null;
};

/// The latest run of each nightly job. A run with no finishedAt was cut off.
export async function cronHealth(actor: Pick<User, "role">): Promise<CronJobHealth[]> {
  assertCanManage(actor);
  return Promise.all(
    CRON_JOBS.map(async (job) => {
      const run = await prisma.cronRun.findFirst({ where: { job }, orderBy: { startedAt: "desc" } });
      if (!run) return { job, lastRun: null };
      const summary = (run.summary ?? {}) as { failedSteps?: unknown };
      const failedSteps = Array.isArray(summary.failedSteps) ? summary.failedSteps.map(String) : [];
      return { job, lastRun: { startedAt: run.startedAt, finishedAt: run.finishedAt, ok: run.ok, failedSteps } };
    }),
  );
}

/// A person closes an issue: it is handled. It opens again if it happens again.
export async function resolveSystemIssue(actor: Pick<User, "id" | "role">, issueId: string, note?: string): Promise<void> {
  assertCanManage(actor);
  const issue = await prisma.systemIssue.findUnique({ where: { id: issueId } });
  if (!issue) throw new DomainError("systemIssues.notFound", "התקלה לא נמצאה.");
  if (issue.status === "RESOLVED") return;
  const cleanNote = note?.trim() ? note.trim().slice(0, 1000) : undefined;
  await prisma.systemIssue.update({
    where: { id: issueId },
    data: { status: "RESOLVED", resolvedAt: new Date(), resolvedById: actor.id, ...(cleanNote ? { note: cleanNote } : {}) },
  });
  await recordAudit({ actorId: actor.id, action: "system_issue.resolved", entityType: "SystemIssue", entityId: issueId, after: { area: issue.area, key: issue.key } });
}

const PR_URL = /^https:\/\/github\.com\/arielankora\/[A-Za-z0-9_.-]+\/pull\/\d+$/;

/// A note and a pull request link on an issue. What the nightly analysis
/// leaves when it opens a fix, so the screen and the next analysis see the
/// issue is being handled. Does not change the issue's status.
export async function annotateSystemIssue(
  actor: Pick<User, "id" | "role">,
  issueId: string,
  input: { note?: string; prUrl?: string },
): Promise<SystemIssueRow> {
  assertCanManage(actor);
  const note = input.note?.trim();
  const prUrl = input.prUrl?.trim();
  if (!note && !prUrl) throw new DomainError("systemIssues.nothingToSave", "צריך הערה או קישור לבקשת מיזוג.");
  if (prUrl && !PR_URL.test(prUrl)) {
    throw new DomainError("systemIssues.badPrUrl", "הקישור צריך להיות לבקשת מיזוג בריפו של אנקורה ב-GitHub.");
  }
  const issue = await prisma.systemIssue.findUnique({ where: { id: issueId }, select: { id: true } });
  if (!issue) throw new DomainError("systemIssues.notFound", "התקלה לא נמצאה.");
  const updated = await prisma.systemIssue.update({
    where: { id: issueId },
    data: { ...(note ? { note: note.slice(0, 1000) } : {}), ...(prUrl ? { prUrl } : {}) },
    select: SELECT,
  });
  await recordAudit({ actorId: actor.id, action: "system_issue.annotated", entityType: "SystemIssue", entityId: issueId, after: { note: Boolean(note), prUrl: prUrl ?? null } });
  return updated;
}

/// The issues as the connector returns them. An email issue's detail names
/// the email's subject, which can name a client, including one marked
/// "בלי AI"; the connector gets the error without it. Everything else in an
/// issue is about the system, not a client.
export function issuesForAi<T extends Pick<SystemIssueRow, "area" | "detail">>(rows: T[]): T[] {
  return rows.map((row) =>
    row.area === "email" && row.detail?.includes(EMAIL_SUBJECT_MARK) ? { ...row, detail: row.detail.split(EMAIL_SUBJECT_MARK)[0] } : row,
  );
}
