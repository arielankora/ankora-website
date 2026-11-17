import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { StatusBadge } from "@/components/app/StatusBadge";
import { getClaudeUsageReport, USAGE_PERIODS } from "@/lib/app-domain/claude-usage";
import type { SeatStatus } from "@/lib/claude-usage/report-math";
import { saveClaudeUsageSettingsAction } from "./actions";

// Claude usage measurement, stage 3 (17.11.2026): how much of Claude's
// allowance each person uses, what Ankora's tools and prompts send, and
// where the waste is. SUPER_ADMIN only (claude_usage.view). The numbers
// come from lib/app-domain/claude-usage.ts, the same report the
// get_claude_usage tool gives Claude.
//
// Server components only, with a plain form for the settings, so the page
// needs no client dictionary.

export const metadata = { robots: { index: false, follow: false } };

const TONE: Record<SeatStatus, "green" | "amber" | "red"> = { ok: "green", near: "amber", over: "red" };

const cell = "px-2 py-2 font-jbmono text-[13px] text-app-text-primary";
const head = "px-2 py-2 text-start font-medium";

export default async function ClaudeUsagePage({ searchParams }: { searchParams: Promise<{ days?: string; saved?: string; error?: string }> }) {
  const user = await requireUser();
  if (!can(user.role, "claude_usage.view")) notFound();
  const sp = await searchParams;
  const days = sp.days === "30" ? 30 : 7;
  const report = await getClaudeUsageReport(user, { days });
  const t = await getTranslations("claudeUsage");
  const f = await getFormatter();

  const usd = (n: number) => f.number(n, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
  const int = (n: number) => f.number(n);
  const bytes = (n: number) => (n >= 1_000_000 ? `${f.number(n / 1_000_000, { maximumFractionDigits: 1 })} MB` : `${f.number(Math.round(n / 1000))} KB`);
  const when = (iso: string) => f.dateTime(new Date(iso), { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
  const none = t("none");
  const hasData = report.coverage.coworkEvents + report.coverage.toolCalls + report.coverage.promptCopies > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-medium text-app-text-primary">{t("title")}</h1>
          <p className="mt-1 max-w-3xl text-sm text-app-text-secondary">{t("intro")}</p>
        </div>
        <nav className="flex gap-2" aria-label={t("period", { days })}>
          {USAGE_PERIODS.map((d) => (
            <Link
              key={d}
              href={`/app/claude-usage?days=${d}`}
              aria-current={d === days ? "page" : undefined}
              className={`rounded-full border px-3 py-1 text-[12.5px] ${d === days ? "border-gold bg-white font-medium text-app-text-primary" : "border-app-border text-app-text-secondary hover:border-gold"}`}
            >
              {t("periodOption", { days: d })}
            </Link>
          ))}
        </nav>
      </div>

      {!hasData && <p className="rounded-2xl border border-app-border bg-white p-5 text-sm text-app-text-tertiary">{t("empty")}</p>}

      <section className="rounded-2xl border border-app-border bg-white p-5" data-testid="usage-people">
        <h2 className="text-sm font-medium text-app-text-primary">{t("people.title")}</h2>
        {!report.settings.alertsLive && <p className="mt-1 text-xs text-app-text-secondary">{t("people.alertsOff")}</p>}
        {report.month.measuredSince && (
          <p className="mt-1 text-xs text-app-text-secondary">{t("people.measuredSince", { date: f.dateTime(new Date(report.month.measuredSince), { day: "numeric", month: "numeric" }) })}</p>
        )}
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr className="border-b border-app-border text-xs text-app-text-secondary">
                <th className="py-2 pe-3 text-start font-medium">{t("people.name")}</th>
                <th className={head}>{t("people.seat")}</th>
                <th className={head}>{t("people.requests")}</th>
                <th className={head}>{t("people.cost")}</th>
                <th className={head}>{t("people.month")}</th>
                <th className={head}>{t("people.limitHits")}</th>
                <th className={head}>{t("people.window")}</th>
                <th className={head}>{t("people.cache")}</th>
                <th className={head}>{t("people.connector")}</th>
                <th className={head}>{t("people.connectorBytes")}</th>
                <th className={head}>{t("people.prompts")}</th>
                <th className={head}>{t("people.last")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-app-border">
              {report.people.map((p) => (
                <tr key={p.userId}>
                  <td className="py-2 pe-3 text-app-text-primary" dir="auto">
                    {p.name}
                    {p.noTelemetry && <p className="text-xs text-app-warning">{t("people.noTelemetry")}</p>}
                  </td>
                  <td className={cell}>{usd(p.seatUsd)}</td>
                  <td className={cell}>{int(p.cowork.requests)}</td>
                  <td className={cell}>{usd(p.cowork.costUsd)}</td>
                  <td className="px-2 py-2">
                    <StatusBadge label={t(`status.${p.month.status}`)} tone={TONE[p.month.status]} />
                    <p className="mt-1 font-jbmono text-[12px] text-app-text-secondary">
                      {p.month.projectedUsd === null
                        ? t("people.monthValueNoPace", { cost: usd(p.month.costUsd), threshold: usd(p.month.thresholdUsd) })
                        : t("people.monthValue", { cost: usd(p.month.costUsd), threshold: usd(p.month.thresholdUsd), projected: usd(p.month.projectedUsd) })}
                    </p>
                  </td>
                  <td className={`${cell} ${p.cowork.limitHits > 0 ? "text-app-error" : ""}`}>{int(p.cowork.limitHits)}</td>
                  <td className={cell}>{p.cowork.heaviestWindow ? `${usd(p.cowork.heaviestWindow.costUsd)} · ${when(p.cowork.heaviestWindow.start)}` : none}</td>
                  <td className={cell}>{p.cowork.cacheSharePct === null ? none : `${p.cowork.cacheSharePct}%`}</td>
                  <td className={cell}>{int(p.connector.calls)}</td>
                  <td className={cell}>{p.connector.calls ? bytes(p.connector.bytes) : none}</td>
                  <td className={cell}>{int(p.prompts.copies)}</td>
                  <td className={cell}>{p.cowork.lastEventAt ? when(p.cowork.lastEventAt) : none}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="usage-signals">
        {(
          [
            ["briefThenFile", report.signals.briefThenFile],
            ["duplicateReads", report.signals.duplicateReads],
            ["truncated", report.signals.truncatedAnswers],
            ["limitHits", report.signals.limitHits],
          ] as const
        ).map(([key, value]) => (
          <div key={key} className="rounded-2xl border border-app-border bg-white p-5">
            <p className="text-sm font-medium text-app-text-primary">{t(`signals.${key}`)}</p>
            <p className="mt-2 font-jbmono text-2xl text-app-text-primary">{int(value)}</p>
            <p className="mt-2 text-xs text-app-text-secondary">{t(`signals.${key}About`)}</p>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-app-border bg-white p-5" data-testid="usage-tools">
        <h2 className="text-sm font-medium text-app-text-primary">{t("tools.title")}</h2>
        <p className="mt-1 text-xs text-app-text-secondary">{t("tools.intro")}</p>
        {report.tools.length === 0 ? (
          <p className="mt-3 text-sm text-app-text-tertiary">{t("tools.none")}</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-app-border text-xs text-app-text-secondary">
                  {(["tool", "calls", "people", "avg", "max", "total", "failures", "truncated", "images", "duplicates"] as const).map((k) => (
                    <th key={k} className={head}>
                      {t(`tools.${k}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-app-border">
                {report.tools.map((x) => (
                  <tr key={x.tool}>
                    <td className={cell} dir="ltr">
                      {x.tool}
                    </td>
                    <td className={cell}>{int(x.calls)}</td>
                    <td className={cell}>{int(x.people)}</td>
                    <td className={cell}>{bytes(x.avgBytes)}</td>
                    <td className={cell}>{bytes(x.maxBytes)}</td>
                    <td className={cell}>{bytes(x.totalBytes)}</td>
                    <td className={cell}>{int(x.failures)}</td>
                    <td className={cell}>{int(x.truncated)}</td>
                    <td className={cell}>{int(x.images)}</td>
                    <td className={`${cell} ${x.duplicates > 0 ? "text-app-warning" : ""}`}>{int(x.duplicates)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-app-border bg-white p-5" data-testid="usage-prompts">
        <h2 className="text-sm font-medium text-app-text-primary">{t("prompts.title")}</h2>
        {report.prompts.length === 0 ? (
          <p className="mt-3 text-sm text-app-text-tertiary">{t("prompts.none")}</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-b border-app-border text-xs text-app-text-secondary">
                <th className="py-2 pe-3 text-start font-medium">{t("prompts.kind")}</th>
                <th className={head}>{t("prompts.copies")}</th>
                <th className={head}>{t("prompts.avg")}</th>
                <th className={head}>{t("prompts.max")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-app-border">
              {report.prompts.map((p) => (
                <tr key={p.kind}>
                  <td className="py-2 pe-3 text-app-text-primary">{t(`prompts.kinds.${p.kind}`)}</td>
                  <td className={cell}>{int(p.copies)}</td>
                  <td className={cell}>{int(p.avgChars)}</td>
                  <td className={cell}>{int(p.maxChars)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-2xl border border-app-border bg-white p-5" data-testid="usage-heavy">
        <h2 className="text-sm font-medium text-app-text-primary">{t("heavy.title")}</h2>
        <p className="mt-1 text-xs text-app-text-secondary">{t("heavy.intro")}</p>
        {report.heaviestRequests.length === 0 ? (
          <p className="mt-3 text-sm text-app-text-tertiary">{t("heavy.none")}</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-app-border text-xs text-app-text-secondary">
                  {(["who", "when", "cost", "requests", "models", "tools"] as const).map((k) => (
                    <th key={k} className={head}>
                      {t(`heavy.${k}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-app-border">
                {report.heaviestRequests.map((r) => (
                  <tr key={r.promptId}>
                    <td className="px-2 py-2 text-app-text-primary" dir="auto">
                      {r.name}
                    </td>
                    <td className={cell}>{when(r.at)}</td>
                    <td className={cell}>{usd(r.costUsd)}</td>
                    <td className={cell}>{int(r.requests)}</td>
                    <td className={cell} dir="ltr">
                      {r.models.join(", ") || none}
                    </td>
                    <td className={cell} dir="ltr">
                      {r.ankoraTools.join(", ") || none}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section id="settings" className="rounded-2xl border border-app-border bg-white p-5" data-testid="usage-settings">
        <h2 className="text-sm font-medium text-app-text-primary">{t("settings.title")}</h2>
        <p className="mt-1 text-xs text-app-text-secondary">{t("settings.intro")}</p>
        {sp.saved && (
          <p className="mt-2 text-sm text-app-success" role="status">
            {t("settings.saved")}
          </p>
        )}
        {sp.error && (
          <p className="mt-2 text-sm text-app-error" role="alert">
            {t("settings.error", { message: sp.error })}
          </p>
        )}
        <form action={saveClaudeUsageSettingsAction} className="mt-3 space-y-4">
          <input type="hidden" name="days" value={days} />
          <div className="flex flex-wrap gap-4">
            <label className="flex flex-col gap-1 text-xs text-app-text-secondary">
              {t("settings.defaultSeat")}
              <input name="defaultSeat" type="number" min={1} max={1000} step="1" defaultValue={report.settings.defaultSeatUsd} className="w-32 rounded-lg border border-app-border px-2 py-1 font-jbmono text-sm text-app-text-primary" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-app-text-secondary">
              {t("settings.multiplier")}
              <input name="multiplier" type="number" min={0.1} max={50} step="0.1" defaultValue={report.settings.multiplier} className="w-32 rounded-lg border border-app-border px-2 py-1 font-jbmono text-sm text-app-text-primary" />
            </label>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {report.people.map((p) => (
              <label key={p.userId} className="flex items-center justify-between gap-2 rounded-lg border border-app-border px-3 py-2 text-sm text-app-text-primary">
                <span dir="auto">{p.name}</span>
                <input
                  name={`seat:${p.userId}`}
                  type="number"
                  min={1}
                  max={1000}
                  step="1"
                  aria-label={`${t("settings.seatFor")}: ${p.name}`}
                  placeholder={String(report.settings.defaultSeatUsd)}
                  defaultValue={report.settings.seats[p.userId] ?? ""}
                  className="w-24 rounded-lg border border-app-border px-2 py-1 font-jbmono text-sm"
                />
              </label>
            ))}
          </div>
          <button type="submit" className="rounded-full border border-app-border bg-white px-4 py-1.5 text-[12.5px] font-medium text-app-text-primary hover:border-gold">
            {t("settings.save")}
          </button>
        </form>
      </section>

      <section className="rounded-2xl border border-app-border bg-white p-5 text-xs text-app-text-secondary" data-testid="usage-coverage">
        <h2 className="text-sm font-medium text-app-text-primary">{t("coverage.title")}</h2>
        <p className="mt-1">{t("coverage.line", { events: int(report.coverage.coworkEvents), calls: int(report.coverage.toolCalls), copies: int(report.coverage.promptCopies) })}</p>
        {report.coverage.unmatchedEmails.length > 0 && <p className="mt-1" dir="auto">{t("coverage.unmatched", { emails: report.coverage.unmatchedEmails.join(", ") })}</p>}
      </section>
    </div>
  );
}
