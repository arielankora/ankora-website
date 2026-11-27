import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { StatusBadge } from "@/components/app/StatusBadge";
import { cronHealth, listSystemIssues, type CronJobHealth, type SystemIssueRow } from "@/lib/app-domain/system-issues";
import { resolveSystemIssueAction } from "./actions";

// System issues (27.11.2026, silent failures plan, stage 1b). Every failure
// the system recorded (lib/system-issues.ts), open first, with what a
// person or Claude noted about it, and the latest run of each nightly job.
// For the admins, who get the alerts.

export const metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function SystemIssuesPage({ searchParams }: { searchParams: Promise<{ resolved?: string; error?: string }> }) {
  const user = await requireUser();
  if (!can(user.role, "system_issue.manage")) notFound();
  const params = await searchParams;
  const [{ open, resolved }, jobs] = await Promise.all([listSystemIssues(user), cronHealth(user)]);
  const t = await getTranslations("systemIssues");
  const format = await getFormatter();
  const when = (d: Date) => format.dateTime(d, { dateStyle: "short", timeStyle: "short" });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-medium text-app-text-primary">{t("title")}</h1>
        <p className="mt-1 text-sm text-app-text-secondary">{t("intro")}</p>
      </div>

      {params.resolved && <p className="rounded-xl border border-app-success/30 bg-app-success-soft px-3 py-2 text-sm text-app-text-primary">{t("resolvedDone")}</p>}
      {params.error && <p className="rounded-xl border border-app-error/30 bg-app-error-soft px-3 py-2 text-sm text-app-error">{params.error}</p>}

      <section className="space-y-3" data-testid="issues-open">
        <h2 className="text-sm font-medium text-app-text-primary">{t("openTitle", { count: open.length })}</h2>
        {open.length === 0 ? (
          <p className="rounded-2xl border border-app-border bg-white p-5 text-sm text-app-text-secondary">{t("noneOpen")}</p>
        ) : (
          open.map((issue) => <IssueCard key={issue.id} issue={issue} when={when} t={t} />)
        )}
      </section>

      <section className="rounded-2xl border border-app-border bg-white p-5" data-testid="cron-health">
        <h2 className="text-sm font-medium text-app-text-primary">{t("jobsTitle")}</h2>
        <div className="relative mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-app-border text-xs text-app-text-secondary">
                <th className="py-2 pe-3 text-start font-medium">{t("jobColumn")}</th>
                <th className="px-2 py-2 text-start font-medium">{t("lastRunColumn")}</th>
                <th className="px-2 py-2 text-start font-medium">{t("stateColumn")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-app-border">
              {jobs.map((job) => (
                <tr key={job.job}>
                  <td className="py-2 pe-3 font-jbmono text-[13px]" dir="ltr">{job.job}</td>
                  <td className="px-2 py-2 text-app-text-secondary">{job.lastRun ? when(job.lastRun.startedAt) : t("never")}</td>
                  <td className="px-2 py-2">
                    <JobState job={job} t={t} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {resolved.length > 0 && (
        <section className="rounded-2xl border border-app-border bg-white p-5" data-testid="issues-resolved">
          <h2 className="text-sm font-medium text-app-text-primary">{t("resolvedTitle")}</h2>
          <ul className="mt-3 divide-y divide-app-border text-sm">
            {resolved.map((issue) => (
              <li key={issue.id} className="py-2">
                <p dir="auto" className="text-app-text-primary">{issue.title}</p>
                <p className="text-xs text-app-text-tertiary">
                  {t("resolvedAt", { when: issue.resolvedAt ? when(issue.resolvedAt) : "" })}
                  {issue.note ? ` · ${issue.note}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

type T = Awaited<ReturnType<typeof getTranslations<"systemIssues">>>;

function IssueCard({ issue, when, t }: { issue: SystemIssueRow; when: (d: Date) => string; t: T }) {
  return (
    <article className="rounded-2xl border border-app-border bg-white p-5" data-testid="issue">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p dir="auto" className="text-sm font-medium text-app-text-primary">{issue.title}</p>
        <StatusBadge label={t(`severity.${issue.severity}`)} tone={issue.severity === "CRITICAL" ? "red" : "amber"} />
      </div>
      <p className="mt-1 font-jbmono text-[12px] text-app-text-tertiary" dir="ltr">
        {issue.area} / {issue.key}
      </p>
      {issue.detail && (
        <p dir="auto" className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-app-surface-sunken px-3 py-2 font-jbmono text-[12px] text-app-text-secondary">
          {issue.detail}
        </p>
      )}
      <p className="mt-2 text-xs text-app-text-secondary">
        {t("seen", { count: issue.count, first: when(issue.firstSeenAt), last: when(issue.lastSeenAt) })}
      </p>
      {(issue.note || issue.prUrl) && (
        <p className="mt-2 text-xs text-app-text-primary">
          {issue.note && <span dir="auto">{issue.note} </span>}
          {issue.prUrl && (
            <a href={issue.prUrl} target="_blank" rel="noopener noreferrer" className="tap-area text-app-text-accent underline">
              {t("prLink")}
            </a>
          )}
        </p>
      )}
      <form action={resolveSystemIssueAction} className="mt-3 flex flex-wrap items-center gap-2">
        <input type="hidden" name="issueId" value={issue.id} />
        <input
          name="note"
          placeholder={t("notePlaceholder")}
          aria-label={t("notePlaceholder")}
          maxLength={1000}
          className="min-w-0 flex-1 rounded-full border border-app-border px-3 py-1.5 text-[13px]"
        />
        <button type="submit" className="tap-area rounded-full border border-app-border px-4 py-1.5 text-[12.5px] font-medium text-app-text-primary hover:border-gold">
          {t("resolve")}
        </button>
      </form>
    </article>
  );
}

function JobState({ job, t }: { job: CronJobHealth; t: T }) {
  const run = job.lastRun;
  if (!run) return <StatusBadge label={t("state.never")} tone="gray" />;
  if (!run.finishedAt) return <StatusBadge label={t("state.cutOff")} tone="red" />;
  if (run.ok) return <StatusBadge label={t("state.ok")} tone="green" />;
  return <StatusBadge label={t("state.failed", { steps: run.failedSteps.join(", ") })} tone="red" />;
}
