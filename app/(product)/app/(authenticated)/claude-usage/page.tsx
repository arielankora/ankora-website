import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { StatusBadge } from "@/components/app/StatusBadge";
import { getClaudeUsageReport, USAGE_PERIODS } from "@/lib/app-domain/claude-usage";
import type { KpiState, Verdict } from "@/lib/claude-usage/summary";
import type { FiveHourState, WindowCell } from "@/lib/claude-usage/five-hour";
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

const KPI_TONE: Record<KpiState, "green" | "amber" | "red" | "gray"> = { ok: "green", watch: "amber", off: "red", none: "gray" };
const VERDICT_TONE: Record<Verdict, "green" | "amber" | "red"> = { ok: "green", partial: "amber", attention: "red" };

// The five-hour window (design option ג, 17.11.2026).
const FIVE_TONE: Record<FiveHourState, "green" | "amber" | "red" | "gray"> = { stuck: "red", near: "red", watch: "amber", free: "green", idle: "gray", unknown: "gray" };
const FIVE_BAR: Record<FiveHourState, string> = { stuck: "bg-app-error", near: "bg-app-error", watch: "bg-app-warning", free: "bg-app-success", idle: "bg-app-border", unknown: "bg-app-border" };
const FIVE_TEXT: Record<FiveHourState, string> = { stuck: "text-app-error", near: "text-app-error", watch: "text-app-warning", free: "text-app-success", idle: "text-app-text-secondary", unknown: "text-app-text-secondary" };
const SQUARE = "inline-block h-3.5 w-3.5 rounded-[3px] box-border";
function squareClass(w: Pick<WindowCell, "hit" | "peakPct">): string {
  if (w.hit) return `${SQUARE} bg-app-error`;
  if (w.peakPct === null) return `${SQUARE} border border-dashed border-app-text-tertiary bg-app-neutral-soft`;
  if (w.peakPct >= 70) return `${SQUARE} bg-app-warning/45`;
  return `${SQUARE} border border-app-success bg-app-success-soft`;
}

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
  const actionText = (a: (typeof sum.actions)[number]) => {
    const v = a.values;
    return { title: t(`summary.action.${a.key}.title`, v), detail: t(`summary.action.${a.key}.detail`, v) };
  };

  // Five-hour window helpers.
  const weeklyTone = (pct: number | null) => (pct === null ? "text-app-text-tertiary" : pct >= 80 ? "text-app-error" : pct > 60 ? "text-app-warning" : "text-app-text-secondary");
  const five = report.fiveHour;
  const nowMs = Date.parse(report.period.to);
  const left = (iso: string) => {
    const min = Math.max(0, Math.round((Date.parse(iso) - nowMs) / 60_000));
    return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
  };
  const clock = (iso: string) => f.dateTime(new Date(iso), { hour: "2-digit", minute: "2-digit" });
  const hourLabel = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;
  const fiveNote = (p: (typeof report.people)[number]) => {
    const c = p.fiveHour.current;
    const parts: string[] = [];
    if (c.source === "cowork" && c.hitAt && c.resetsAt) parts.push(t("five.note.coworkOnly", { time: clock(c.hitAt), time2: left(c.resetsAt) }));
    else if (c.state === "unknown") parts.push(t("five.note.unknown"));
    else {
      if (c.hitAt) parts.push(t("five.note.hitAt", { time: clock(c.hitAt) }));
      parts.push(c.resetsAt ? t("five.note.resets", { time: left(c.resetsAt) }) : t("five.note.noWindow"));
    }
    return parts.join(" · ");
  };
  const cellLabel = (name: string, w: WindowCell) => {
    const at = when(w.start);
    if (w.hit) return t("five.cell.hit", { name, when: at });
    if (w.peakPct === null) return t("five.cell.unknown", { name, when: at });
    return t("five.cell.pct", { name, when: at, pct: w.peakPct });
  };
  // Who is closest to getting stuck first, then the rest as before.
  const fiveRank: Record<FiveHourState, number> = { stuck: 0, near: 1, watch: 2, free: 3, idle: 4, unknown: 5 };
  const fivePeople = [...report.people].sort(
    (a, b) => fiveRank[a.fiveHour.current.state] - fiveRank[b.fiveHour.current.state] || (b.fiveHour.current.pct ?? -1) - (a.fiveHour.current.pct ?? -1) || b.fiveHour.hitsThisWeek - a.fiveHour.hitsThisWeek
  );
  const headline = [
    five.stuckNow.length ? t("five.headline.stuck", { names: five.stuckNow.map((x) => x.name).join(", ") }) : null,
    five.over70Now.some((x) => x.pct >= 90) ? t("five.headline.near", { list: five.over70Now.filter((x) => x.pct >= 90).map((x) => `${x.name} ${x.pct}%`).join(", ") }) : null,
  ].filter(Boolean).join(" ");
  const fiveKpis = [
    {
      key: "stuckNow" as const,
      value: String(five.stuckNow.length),
      tone: five.stuckNow.length ? "text-app-error" : "text-app-text-primary",
      sub: five.stuckNow.length
        ? five.stuckNow.map((x) => (x.resetsAt ? t("five.kpi.stuckNow.sub", { name: x.name, time: left(x.resetsAt) }) : t("five.kpi.stuckNow.subNoTime", { name: x.name }))).join(" · ")
        : t("five.kpi.stuckNow.none"),
    },
    {
      key: "over70" as const,
      value: five.measuredNow ? String(five.over70Now.length) : none,
      tone: five.over70Now.length ? "text-app-warning" : "text-app-text-primary",
      sub: five.over70Now.length ? five.over70Now.map((x) => `${x.name} ${x.pct}%`).join(", ") : t("five.kpi.over70.none"),
    },
    {
      key: "hits" as const,
      value: String(five.hitsThisWeek),
      tone: five.hitsThisWeek ? "text-app-error" : "text-app-text-primary",
      sub: five.peakHours ? t("five.kpi.hits.peak", { from: hourLabel(five.peakHours.from), to: hourLabel(five.peakHours.to) }) : t("five.kpi.hits.noPeak"),
    },
    {
      key: "weekly" as const,
      value: five.closestWeekly ? `${five.closestWeekly.pct}%` : none,
      tone: five.closestWeekly && five.closestWeekly.pct >= 80 ? "text-app-error" : five.closestWeekly && five.closestWeekly.pct > 60 ? "text-app-warning" : "text-app-text-primary",
      sub: five.closestWeekly ? t("five.kpi.weekly.sub", { name: five.closestWeekly.name }) : t("five.kpi.weekly.none"),
    },
  ];

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
              className={`tap-area rounded-full border px-3 py-1 text-[12.5px] ${d === days ? "border-gold bg-white font-medium text-app-text-primary" : "border-app-border text-app-text-secondary hover:border-gold"}`}
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
          {headline ? `${headline} ` : ""}
          {t(`summary.verdictLine.${sum.verdict}`)} {t("summary.offCount", { count: offCount })}
        </p>
      </section>

      {/* The five-hour window first (17.11.2026, Ariel: people get stuck in
          the five-hour window, not on the monthly threshold). Design
          option ג: four indicators, then each person's current window and
          the past week window by window. */}
      <section aria-label={t("five.title")} className="space-y-3" data-testid="usage-five-hour">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {fiveKpis.map((k) => (
            <div key={k.key} className="rounded-2xl border border-app-border bg-white p-4">
              <p className="text-sm text-app-text-secondary">{t(`five.kpi.${k.key}.label`)}</p>
              <p className={`mt-1 font-jbmono text-2xl ${k.tone}`}>{k.value}</p>
              <p className="mt-1 text-xs text-app-text-secondary" dir="auto">{k.sub}</p>
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-app-border bg-white p-5" data-testid="usage-team">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-medium text-app-text-primary">{t("five.title")}</h2>
            <span className="text-xs text-app-text-secondary">{t("five.about")}</span>
          </div>
          {five.measuredNow === 0 && <p className="mt-2 rounded-xl bg-app-warning-soft p-3 text-xs text-app-text-primary">{t("five.noExtension")}</p>}
          <div className="mt-3 hidden grid-cols-[minmax(0,10rem)_minmax(0,1fr)_minmax(0,13rem)_7rem] gap-4 pb-2 text-xs text-app-text-secondary md:grid">
            <span>{t("five.col.person")}</span>
            <span>{t("five.col.now")}</span>
            <span>{t("five.col.week")}</span>
            <span>{t("five.col.state")}</span>
          </div>
          <ul className="divide-y divide-app-border border-t border-app-border">
            {fivePeople.map((p) => {
              const c = p.fiveHour.current;
              const pct = c.pct === null ? 0 : Math.min(100, Math.round(c.pct));
              return (
                <li key={p.userId} className="grid grid-cols-1 items-center gap-3 py-3 md:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_minmax(0,13rem)_7rem] md:gap-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-app-text-primary" dir="auto">{p.name}</p>
                    {/* The weekly limit, as the extension reads it (18.11.2026:
                        replaced Cowork's cost against the seat price). */}
                    <p className={`text-xs ${weeklyTone(p.fiveHour.weeklyPct)}`}>
                      {p.fiveHour.weeklyPct === null ? t("five.weeklyNone") : t("five.weekly", { pct: Math.round(p.fiveHour.weeklyPct) })}
                    </p>
                  </div>
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-3">
                      <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-app-neutral-soft" role="img" aria-label={`${p.name}: ${c.pct === null ? t("five.state.unknown") : `${pct}%`}`}>
                        <div className={`h-full rounded-full ${FIVE_BAR[c.state]}`} style={{ width: `${pct}%` }} />
                        <div className="absolute inset-y-0 w-0.5 bg-white" style={{ insetInlineStart: "70%" }} />
                        <div className="absolute inset-y-0 w-0.5 bg-white" style={{ insetInlineStart: "90%" }} />
                      </div>
                      <span className={`min-w-[2.75rem] font-jbmono text-sm font-medium ${FIVE_TEXT[c.state]}`}>{c.pct === null ? none : `${pct}%`}</span>
                    </div>
                    <p className="text-xs text-app-text-secondary">{fiveNote(p)}</p>
                  </div>
                  <div
                    className="flex flex-wrap gap-[3px]"
                    role="img"
                    aria-label={t("five.weekAria", { name: p.name, count: p.fiveHour.week.length, hits: p.fiveHour.hitsThisWeek })}
                  >
                    {p.fiveHour.week.length === 0 ? (
                      <span className="text-xs text-app-text-tertiary">{t("five.weekNone")}</span>
                    ) : (
                      p.fiveHour.week.map((w) => <span key={w.start} className={squareClass(w)} title={cellLabel(p.name, w)} />)
                    )}
                  </div>
                  <div>
                    <StatusBadge label={t(`five.state.${c.state}`)} tone={FIVE_TONE[c.state]} />
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-app-text-secondary">
            {(
              [
                ["free", { hit: false, peakPct: 10 }],
                ["watch", { hit: false, peakPct: 80 }],
                ["hit", { hit: true, peakPct: 100 }],
                ["unknown", { hit: false, peakPct: null }],
              ] as const
            ).map(([key, w]) => (
              <span key={key} className="inline-flex items-center gap-1.5">
                <span className={squareClass(w)} aria-hidden="true" />
                {t(`five.legend.${key}`)}
              </span>
            ))}
          </div>
        </div>
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
                {k.key === "closestToWeeklyLimit" && k.who ? t("summary.kpi.closestToWeeklyLimit.targetWho", { who: k.who }) : t(`summary.kpi.${k.key}.target`)}
              </p>
            </div>
          ))}
        </div>
      </section>

      <div className="grid items-start gap-5 lg:grid-cols-2">
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

      <h2 className="pt-2 text-base font-medium text-app-text-primary">{t("summary.details")}</h2>

      <section className="rounded-2xl border border-app-border bg-white p-5" data-testid="usage-people">
        <h2 className="text-sm font-medium text-app-text-primary">{t("people.title")}</h2>
        <p className="mt-1 text-xs text-app-text-secondary">{t("people.costAbout")}</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-app-border text-xs text-app-text-secondary">
                <th className="py-2 pe-3 text-start font-medium">{t("people.name")}</th>
                <th className={head}>{t("people.requests")}</th>
                <th className={head}>{t("people.cost")}</th>
                <th className={head}>{t("people.limitHits")}</th>
                <th className={head}>{t("people.window")}</th>
                <th className={head}>{t("people.cache")}</th>
                <th className={head}>{t("people.connector")}</th>
                <th className={head}>{t("people.connectorBytes")}</th>
                <th className={head}>{t("people.prompts")}</th>
                <th className={head}>{t("people.limits")}</th>
                <th className={head}>{t("people.bySource")}</th>
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
                  <td className={cell}>{int(p.cowork.requests)}</td>
                  <td className={cell}>{usd(p.cowork.costUsd)}</td>
                  <td className={`${cell} ${p.cowork.limitHits > 0 ? "text-app-error" : ""}`}>{int(p.cowork.limitHits)}</td>
                  <td className={cell}>{p.cowork.heaviestWindow ? `${usd(p.cowork.heaviestWindow.costUsd)} · ${when(p.cowork.heaviestWindow.start)}` : none}</td>
                  <td className={cell}>{p.cowork.cacheSharePct === null ? none : `${p.cowork.cacheSharePct}%`}</td>
                  <td className={cell}>{int(p.connector.calls)}</td>
                  <td className={cell}>{p.connector.calls ? bytes(p.connector.bytes) : none}</td>
                  <td className={cell}>{int(p.prompts.copies)}</td>
                  <td className={cell}>
                    {p.limits?.current ? `${p.limits.current.fiveHourPct ?? none}% / ${p.limits.current.sevenDayPct ?? none}%` : none}
                  </td>
                  <td className={cell}>
                    {p.cowork.bySource.length
                      ? p.cowork.bySource.map((x) => t("people.sourceCount", { source: t(`people.source.${x.source}`), count: x.requests })).join(" · ")
                      : none}
                  </td>
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
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {report.people.map((p) => (
              <div key={p.userId} className="flex flex-col gap-2 rounded-lg border border-app-border px-3 py-2 text-sm text-app-text-primary">
                <input type="hidden" name={`listed:${p.userId}`} value="1" />
                <span dir="auto">{p.name}</span>
                <label className="tap-area flex items-center gap-2 text-xs text-app-text-secondary">
                  <input type="checkbox" name={`nonCowork:${p.userId}`} defaultChecked={p.nonCowork} className="h-4 w-4" />
                  {t("settings.nonCowork")}
                </label>
              </div>
            ))}
          </div>
          <button type="submit" className="tap-area rounded-full border border-app-border bg-white px-4 py-1.5 text-[12.5px] font-medium text-app-text-primary hover:border-gold">
            {t("settings.save")}
          </button>
        </form>
      </section>

      <section className="rounded-2xl border border-app-border bg-white p-5 text-xs text-app-text-secondary" data-testid="usage-coverage">
        <h2 className="text-sm font-medium text-app-text-primary">{t("coverage.title")}</h2>
        <p className="mt-1">{t("coverage.line", { events: int(report.coverage.coworkEvents), calls: int(report.coverage.toolCalls), copies: int(report.coverage.promptCopies) })}</p>
        {report.coverage.unmatchedEmails.length > 0 && <p className="mt-1" dir="auto">{t("coverage.unmatched", { emails: report.coverage.unmatchedEmails.join(", ") })}</p>}
        {report.coverage.unmatchedLimitEmails.length > 0 && (
          <p className="mt-1" dir="auto">
            {t("coverage.unmatchedLimits", { emails: report.coverage.unmatchedLimitEmails.join(", ") })}
          </p>
        )}
      </section>
    </div>
  );
}
