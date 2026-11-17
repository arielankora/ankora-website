import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { StatusBadge } from "@/components/app/StatusBadge";
import { getClaudeUsageReport, USAGE_PERIODS } from "@/lib/app-domain/claude-usage";
import type { SeatStatus } from "@/lib/claude-usage/report-math";
import type { KpiState, Verdict } from "@/lib/claude-usage/summary";
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
const KPI_TONE: Record<KpiState, "green" | "amber" | "red" | "gray"> = { ok: "green", watch: "amber", off: "red", none: "gray" };
const VERDICT_TONE: Record<Verdict, "green" | "amber" | "red"> = { ok: "green", partial: "amber", attention: "red" };
const BAR: Record<SeatStatus | "none", string> = { ok: "bg-app-success", near: "bg-app-warning", over: "bg-app-error", none: "bg-app-border" };

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
  const sum = report.summary;
  const offCount = sum.kpis.filter((k) => k.state === "off").length;
  const sentBytes = report.tools.reduce((n, x) => n + x.totalBytes, 0);
  const heavyTools = report.tools.slice(0, 3).map((x) => ({ tool: x.tool, size: bytes(x.totalBytes), share: sentBytes ? Math.round((x.totalBytes / sentBytes) * 100) : 0 }));
  const personNote = (p: (typeof report.people)[number]) => {
    if (p.noTelemetry) return t("summary.note.noTelemetry");
    if (!p.cowork.requests && !p.connector.calls) return t("summary.note.idle");
    const parts = [t("summary.note.cost", { cost: usd(p.month.costUsd), threshold: usd(p.month.thresholdUsd) }), t("summary.note.hits", { count: p.cowork.limitHits })];
    if (p.cowork.cacheSharePct !== null) parts.push(t("summary.note.cache", { pct: p.cowork.cacheSharePct }));
    return parts.join(" · ");
  };
  const actionText = (a: (typeof sum.actions)[number]) => {
    const v = a.key === "nearThreshold" ? { ...a.values, cost: usd(Number(a.values.cost)), threshold: usd(Number(a.values.threshold)) } : a.values;
    return { title: t(`summary.action.${a.key}.title`, v), detail: t(`summary.action.${a.key}.detail`, v) };
  };

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

      {/* Managers' summary (17.11.2026, "אפשרות ג"): the verdict, six
          leading indicators, the team against the threshold, and what to
          do. Everything below "פרטים" is the full report. */}
      <section aria-label={t("summary.title")} className="flex flex-wrap items-center gap-3 rounded-2xl border border-app-border bg-white p-5" data-testid="usage-summary">
        <StatusBadge label={t(`summary.verdict.${sum.verdict}`)} tone={VERDICT_TONE[sum.verdict]} />
        <p className="flex-1 basis-80 text-sm text-app-text-primary">
          {t(`summary.verdictLine.${sum.verdict}`)} {t("summary.offCount", { count: offCount })}
        </p>
      </section>

      <section aria-label={t("summary.kpisTitle")} className="space-y-2" data-testid="usage-kpis">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium text-app-text-primary">{t("summary.kpisTitle")}</h2>
          <span className="text-xs text-app-text-secondary">{t("summary.kpisAbout")}</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sum.kpis.map((k) => (
            <div key={k.key} className="rounded-2xl border border-app-border bg-white p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm text-app-text-secondary">{t(`summary.kpi.${k.key}.label`)}</p>
                <StatusBadge label={t(`summary.kpiState.${k.state}`)} tone={KPI_TONE[k.state]} />
              </div>
              <p className="mt-2 font-jbmono text-2xl text-app-text-primary">{k.value === null ? none : t(`summary.kpi.${k.key}.value`, { value: k.value })}</p>
              <p className="mt-1 text-xs text-app-text-secondary">
                {k.key === "closestToThreshold" && k.who ? t("summary.kpi.closestToThreshold.targetWho", { who: k.who }) : t(`summary.kpi.${k.key}.target`)}
              </p>
            </div>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap items-start gap-5">
        <section className="min-w-0 flex-[999_1_560px] rounded-2xl border border-app-border bg-white p-5" data-testid="usage-team">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-medium text-app-text-primary">{t("summary.teamTitle")}</h2>
            {report.month.measuredDays < 3 && <span className="text-xs text-app-text-secondary">{t("summary.noPace")}</span>}
          </div>
          <ul className="mt-2 divide-y divide-app-border">
            {report.people.map((p) => {
              const state = p.noTelemetry || (!p.cowork.requests && !p.month.costUsd) ? "none" : p.month.status;
              const pct = p.month.thresholdUsd ? Math.min(100, Math.round((p.month.costUsd / p.month.thresholdUsd) * 100)) : 0;
              return (
                <li key={p.userId} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-app-text-primary" dir="auto">{p.name}</p>
                    <p className="text-xs text-app-text-secondary">{t("summary.seat", { seat: usd(p.seatUsd) })}</p>
                  </div>
                  <div className="min-w-0 space-y-1">
                    <div className="h-2.5 overflow-hidden rounded-full bg-app-neutral-soft" role="img" aria-label={`${p.name}: ${pct}%`}>
                      <div className={`h-full rounded-full ${BAR[state]}`} style={{ width: `${state === "none" ? 0 : Math.max(pct, 2)}%` }} />
                    </div>
                    <p className="text-xs text-app-text-secondary">{personNote(p)}</p>
                  </div>
                  {state === "none" ? <StatusBadge label={t("summary.statusNone")} tone="gray" /> : <StatusBadge label={t(`status.${state}`)} tone={TONE[state]} />}
                </li>
              );
            })}
          </ul>
        </section>

        <div className="flex flex-[1_1_320px] flex-col gap-5">
          <section className="rounded-2xl border border-app-border bg-white p-5" data-testid="usage-actions">
            <h2 className="text-sm font-medium text-app-text-primary">{t("summary.actionsTitle")}</h2>
            {sum.actions.length === 0 ? (
              <p className="mt-3 text-sm text-app-text-tertiary">{t("summary.actionsNone")}</p>
            ) : (
              <ol className="mt-3 space-y-2">
                {sum.actions.map((a, i) => {
                  const text = actionText(a);
                  return (
                    <li key={`${a.key}-${i}`} className="flex items-start gap-3 rounded-xl bg-app-accent-soft p-3">
                      <span className="inline-flex h-6 w-6 flex-none items-center justify-center rounded-full bg-app-text-accent text-xs font-medium text-white">{i + 1}</span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-app-text-primary" dir="auto">{text.title}</p>
                        <p className="mt-0.5 text-xs text-app-text-secondary" dir="auto">{text.detail}</p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          <section className="rounded-2xl border border-app-border bg-white p-5" data-testid="usage-heavy-tools">
            <h2 className="text-sm font-medium text-app-text-primary">{t("summary.toolsTitle")}</h2>
            <p className="mt-1 text-xs text-app-text-secondary">{t("summary.toolsAbout")}</p>
            {heavyTools.length === 0 ? (
              <p className="mt-3 text-sm text-app-text-tertiary">{t("tools.none")}</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {heavyTools.map((x) => (
                  <li key={x.tool} className="space-y-1">
                    <div className="flex justify-between gap-2 text-xs">
                      <span className="font-jbmono text-app-text-primary" dir="ltr">{x.tool}</span>
                      <span className="text-app-text-secondary">{t("summary.toolLine", { size: x.size, share: x.share })}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-app-neutral-soft">
                      <div className="h-full rounded-full bg-app-accent" style={{ width: `${x.share}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <h2 className="pt-2 text-base font-medium text-app-text-primary">{t("summary.details")}</h2>

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
