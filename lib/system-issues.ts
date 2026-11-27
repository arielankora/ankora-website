import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { outgoingOf } from "@/lib/i18n/recipients";
import { appBaseUrl } from "@/lib/email-templates";

/// System issues (27.11.2026, silent failures plan, stage 1).
///
/// Before this, a failure the system hit went to console.error, which lands
/// in Vercel's logs for a few days and is read by nobody: a 36 minute voice
/// message that never got a transcript, WhatsApp messages the webhook lost,
/// a nightly run that stopped on its first step. reportIssue is the one
/// place such a failure is written down where a person will see it.
///
/// One row per (area, key). The same failure again counts on the same row;
/// a resolved one that happens again opens again. A CRITICAL issue emails
/// the admins, at most once in ALERT_EVERY_MS for the same row, and only an
/// email that went out counts (alertAdmins used to count one that failed).

/// Not 24 hours: a nightly job reports at about the same minute each night,
/// and a 24 hour window would skip every second night by a few seconds.
export const ALERT_EVERY_MS = 20 * 60 * 60 * 1000;

const DETAIL_MAX = 600;

export type IssueSeverity = "CRITICAL" | "WARNING";

export type IssueInput = {
  /// What part of the system: "email", "mcp", "cron", "comms", "server", "after-response".
  area: string;
  /// What exactly, stable across occurrences: a tool name, a job and step, a route.
  key: string;
  /// One line for a person, in Hebrew.
  title: string;
  /// The error, or a description of what failed. Never a message body or a secret.
  error?: unknown;
  detail?: string;
  severity: IssueSeverity;
  now?: Date;
};

/// The error as one short line: its name, code and message, cut short.
export function describeError(err: unknown): string {
  if (err === undefined || err === null) return "";
  if (err instanceof Error) {
    const code = (err as Error & { code?: unknown }).code;
    const head = [err.name, typeof code === "string" || typeof code === "number" ? String(code) : null].filter(Boolean).join(" ");
    return `${head}: ${err.message}`.slice(0, DETAIL_MAX);
  }
  return String(err).slice(0, DETAIL_MAX);
}

/// Record a failure, and email the admins when it is CRITICAL and they have
/// not heard about it lately. Never throws: reporting a failure must not
/// become a second failure in the code that hit the first.
export async function reportIssue(input: IssueInput): Promise<void> {
  const now = input.now ?? new Date();
  const detail = (input.detail ?? describeError(input.error)).slice(0, DETAIL_MAX) || null;
  try {
    console.error(`[issue] ${input.area}/${input.key}: ${input.title}`, detail ?? "");
    const issue = await upsertIssue(input, detail, now);
    if (input.severity !== "CRITICAL") return;
    const due = issue.reopened || !issue.lastAlertedAt || now.getTime() - issue.lastAlertedAt.getTime() >= ALERT_EVERY_MS;
    if (!due) return;
    const emailed = await emailAdmins(issue.id, input.title, detail, issue.count, now);
    if (emailed) await prisma.systemIssue.update({ where: { id: issue.id }, data: { lastAlertedAt: now } });
  } catch (err) {
    console.error("[issue] could not record an issue", { area: input.area, key: input.key }, err);
  }
}

/// Close an open issue because what it was about worked again (a nightly
/// step that failed yesterday and succeeded tonight). A no-op when none is open.
export async function resolveIssue(area: string, key: string, now = new Date()): Promise<void> {
  try {
    await prisma.systemIssue.updateMany({
      where: { area, key, status: "OPEN" },
      data: { status: "RESOLVED", resolvedAt: now, resolvedById: null },
    });
  } catch (err) {
    console.error("[issue] could not resolve an issue", { area, key }, err);
  }
}

async function upsertIssue(input: IssueInput, detail: string | null, now: Date) {
  const where = { area_key: { area: input.area, key: input.key } };
  for (let attempt = 0; attempt < 2; attempt++) {
    const existing = await prisma.systemIssue.findUnique({ where });
    if (existing) {
      const reopened = existing.status === "RESOLVED";
      const updated = await prisma.systemIssue.update({
        where: { id: existing.id },
        data: {
          title: input.title,
          detail,
          severity: input.severity,
          lastSeenAt: now,
          count: { increment: 1 },
          ...(reopened ? { status: "OPEN" as const, resolvedAt: null, resolvedById: null } : {}),
        },
      });
      return { ...updated, reopened };
    }
    try {
      const created = await prisma.systemIssue.create({
        data: { area: input.area, key: input.key, title: input.title, detail, severity: input.severity, firstSeenAt: now, lastSeenAt: now },
      });
      return { ...created, reopened: false };
    } catch (err) {
      // Two reports of the same new failure at once: the other one created
      // the row, so count on it.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
      throw err;
    }
  }
  throw new Error("system issue upsert lost the race twice");
}

/// Every active admin, in their own language: a notification in the app and
/// an email. True when at least one email went out.
async function emailAdmins(issueId: string, title: string, detail: string | null, count: number, now: Date): Promise<boolean> {
  const admins = await prisma.user.findMany({
    where: { role: { in: ["SUPER_ADMIN", "ANKORA_ADMIN"] }, status: "ACTIVE", deletedAt: null },
    select: { id: true, email: true, locale: true, timezone: true },
  });
  let emailed = false;
  for (const admin of admins) {
    const { t } = outgoingOf(admin);
    const subject = t("systemIssue.title", { title });
    const body = t("systemIssue.body", { title, detail: detail ?? "", count, link: `${appBaseUrl()}/app/system-issues` });
    const notification = await prisma.notification.create({
      data: { userId: admin.id, type: "system.issue", title: subject, body, entityType: "SystemIssue", entityId: issueId },
    });
    if (!admin.email) continue;
    // reportFailure: false, or an email outage would report itself forever.
    const sent = await sendEmail({ to: [admin.email], subject: `Ankora - ${subject}`, text: body, reportFailure: false });
    if (sent.ok) {
      emailed = true;
      await prisma.notification.update({ where: { id: notification.id }, data: { emailedAt: now } });
    }
  }
  return emailed;
}
