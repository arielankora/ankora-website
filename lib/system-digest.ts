import "server-only";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { appBaseUrl } from "@/lib/email-templates";
import { outgoingOf } from "@/lib/i18n/recipients";
import type { Outgoing } from "@/lib/i18n/outgoing";
import { CRON_JOBS } from "@/lib/app-domain/system-issues";

/// The morning report on system issues (27.11.2026, silent failures plan,
/// stage 3). Every morning, to every admin, also when all is well: a day
/// with no report is itself the sign that something broke, the reporting
/// included.
///
/// Laid out like the daily report on the scheduled tasks (ops-runbooks/
/// daily-scheduled-report.md): a bold first line with how many are open or
/// "all is well", then a table. Here two: the issues, and the nightly runs.

const DAY = 24 * 60 * 60 * 1000;

type IssueRow = {
  area: string;
  title: string;
  severity: "CRITICAL" | "WARNING";
  status: "OPEN" | "RESOLVED";
  count: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  resolvedAt: Date | null;
  resolvedById: string | null;
};

export type DigestData = {
  open: IssueRow[];
  /// Closed in the last day without a person: the failure did not come back.
  closedByItself: IssueRow[];
  jobs: { job: string; startedAt: Date | null; finishedAt: Date | null; ok: boolean | null; failedSteps: string[] }[];
};

export async function loadDigestData(now: Date): Promise<DigestData> {
  const since = new Date(now.getTime() - DAY);
  const select = { area: true, title: true, severity: true, status: true, count: true, firstSeenAt: true, lastSeenAt: true, resolvedAt: true, resolvedById: true } as const;
  const [open, closedByItself, jobs] = await Promise.all([
    prisma.systemIssue.findMany({ where: { status: "OPEN" }, select, orderBy: [{ severity: "asc" }, { lastSeenAt: "desc" }], take: 50 }),
    prisma.systemIssue.findMany({ where: { status: "RESOLVED", resolvedById: null, resolvedAt: { gte: since } }, select, orderBy: { resolvedAt: "desc" }, take: 20 }),
    Promise.all(
      CRON_JOBS.map(async (job) => {
        const run = await prisma.cronRun.findFirst({ where: { job }, orderBy: { startedAt: "desc" } });
        const summary = (run?.summary ?? {}) as { failedSteps?: unknown };
        return {
          job,
          startedAt: run?.startedAt ?? null,
          finishedAt: run?.finishedAt ?? null,
          ok: run?.ok ?? null,
          failedSteps: Array.isArray(summary.failedSteps) ? summary.failedSteps.map(String) : [],
        };
      }),
    ),
  ]);
  return { open, closedByItself, jobs };
}

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderSystemDigest(data: DigestData, now: Date, out: Outgoing): { subject: string; html: string; text: string } {
  const { t, dir, start } = out;
  const date = out.format.dateTime(now, { day: "2-digit", month: "2-digit", year: "numeric" });
  const when = (d: Date | null) => (d ? out.format.dateTime(d, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
  const critical = data.open.filter((i) => i.severity === "CRITICAL").length;
  const subject = t("systemDigest.subject", { date, count: data.open.length });
  const lead = data.open.length === 0 ? t("systemDigest.allGood") : t("systemDigest.lead", { count: data.open.length, critical });
  const link = `${appBaseUrl()}/app/system-issues`;

  const state = (i: IssueRow) =>
    i.status === "RESOLVED" ? t("systemDigest.state.closed") : now.getTime() - i.firstSeenAt.getTime() < DAY ? t("systemDigest.state.new") : t("systemDigest.state.recurring");
  const jobState = (j: DigestData["jobs"][number]) =>
    !j.startedAt ? t("systemDigest.job.never") : !j.finishedAt ? t("systemDigest.job.cutOff") : j.ok ? t("systemDigest.job.ok") : t("systemDigest.job.failed", { steps: j.failedSteps.join(", ") });

  const issues = [...data.open, ...data.closedByItself];
  const th = (s: string) => `<th align="${start}" style="padding:6px 8px;border-bottom:1px solid #D9DEE5;font-size:12px;color:#5B6676;font-weight:600;">${esc(s)}</th>`;
  const td = (s: string, extra = "") => `<td align="${start}" style="padding:6px 8px;border-bottom:1px solid #EEF0F3;font-size:13px;color:#1B2A3D;vertical-align:top;${extra}">${esc(s)}</td>`;
  const issueTable = issues.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="${dir}" style="border-collapse:collapse;margin:8px 0 16px;">
<tr>${th(t("systemDigest.col.area"))}${th(t("systemDigest.col.what"))}${th(t("systemDigest.col.since"))}${th(t("systemDigest.col.count"))}${th(t("systemDigest.col.state"))}</tr>
${issues
  .map(
    (i) =>
      `<tr>${td(i.area)}${td(i.title, i.severity === "CRITICAL" && i.status === "OPEN" ? "font-weight:600;" : "")}${td(when(i.firstSeenAt))}${td(String(i.count))}${td(state(i))}</tr>`,
  )
  .join("\n")}
</table>`
    : "";
  const jobTable = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="${dir}" style="border-collapse:collapse;margin:8px 0 16px;">
<tr>${th(t("systemDigest.col.job"))}${th(t("systemDigest.col.lastRun"))}${th(t("systemDigest.col.state"))}</tr>
${data.jobs.map((j) => `<tr>${td(j.job, "direction:ltr;font-family:monospace;")}${td(when(j.startedAt))}${td(jobState(j))}</tr>`).join("\n")}
</table>`;

  const html = `<!doctype html>
<html dir="${dir}" lang="${out.locale}">
  <body style="margin:0;padding:0;background:#EEF0F3;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF0F3;padding:24px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;background:#FFFFFF;border:1px solid #D9DEE5;border-radius:14px;font-family:Arial,Helvetica,sans-serif;">
          <tr><td style="padding:22px 24px;" dir="${dir}" align="${start}">
            <div style="font-size:11px;font-weight:600;letter-spacing:.22em;color:#8A94A3;">ANKORA</div>
            <p style="margin:10px 0 16px;font-size:17px;font-weight:700;color:#1B2A3D;">${esc(lead)}</p>
            ${issues.length ? `<div style="font-size:12px;font-weight:600;color:#8A94A3;">${esc(t("systemDigest.issuesHeading"))}</div>${issueTable}` : ""}
            <div style="font-size:12px;font-weight:600;color:#8A94A3;">${esc(t("systemDigest.jobsHeading"))}</div>
            ${jobTable}
            <a href="${link}" style="display:inline-block;background:#1B2A3D;color:#FFFFFF;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px;font-weight:600;">${esc(t("systemDigest.open"))}</a>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  const text = [
    lead,
    "",
    ...(issues.length ? [t("systemDigest.issuesHeading"), ...issues.map((i) => `- [${state(i)}] ${i.area}: ${i.title} (${i.count}, ${when(i.firstSeenAt)})`), ""] : []),
    t("systemDigest.jobsHeading"),
    ...data.jobs.map((j) => `- ${j.job}: ${jobState(j)} ${when(j.startedAt)}`),
    "",
    link,
  ].join("\n");

  return { subject, html, text };
}

/// Sends the report to every active admin, in their own language. A failed
/// send is reported by sendEmail itself.
export async function sendSystemDigest(now = new Date()): Promise<{ sent: number; open: number }> {
  const data = await loadDigestData(now);
  const admins = await prisma.user.findMany({
    where: { role: { in: ["SUPER_ADMIN", "ANKORA_ADMIN"] }, status: "ACTIVE", deletedAt: null },
    select: { id: true, email: true, locale: true, timezone: true },
  });
  let sent = 0;
  for (const admin of admins) {
    const out = outgoingOf(admin);
    const { subject, html, text } = renderSystemDigest(data, now, out);
    const result = await sendEmail({ to: [admin.email], subject, text, html });
    if (result.ok) sent += 1;
  }
  return { sent, open: data.open.length };
}
