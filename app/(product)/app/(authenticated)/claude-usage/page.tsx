import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { getClaudeUsageReport, USAGE_PERIODS, type PersonUsage } from "@/lib/app-domain/claude-usage";
import type { Kpi, KpiState, Verdict } from "@/lib/claude-usage/summary";
import type { Pace, WindowCell } from "@/lib/claude-usage/five-hour";
import { saveClaudeUsageSettingsAction } from "./actions";

// Claude usage measurement (17.11.2026, redesigned 19.11.2026 on the design
// canvas, option א): who in the team is close to getting stuck in Claude's
// limits, and what in Ankora sends Claude the most. SUPER_ADMIN only
// (claude_usage.view). The numbers come from lib/app-domain/claude-usage.ts,
// the same report the get_claude_usage tool gives Claude.
//
// The order, top to bottom: one sentence that says what matters now, three
// numbers (stuck now, may get stuck, stuck this week), each person's two
// limits as two bars in one language, what to do, where to save, and the
// detail folded away. The period (7 or 30 days) belongs to the detail only:
// the limits at the top are always now.
//
// Server components only, with a plain form for the settings, so the page
// needs no client dictionary.

export const metadata = { robots: { index: false, follow: false } };

/// One limit of one person, as the screen shows it.
type LimitState = "stuck" | "over" | "watch" | "ok" | "early" | "idle" | "none";
type LimitView = {
  state: LimitState;
  usedPct: number | null;
  elapsedPct: number | null;
  projectedPct: number | null;
  projectedHitAt: string | null;
  resetsAt: string | null;
  /// When the limit was hit, for a window that is stuck now.
  hitAt: string | null;
};

const RANK: Record<LimitState, number> = { stuck: 0, over: 1, watch: 2, ok: 3, early: 4, idle: 5, none: 6 };

// Colors by role, from the app palette. Used is blue, not green: the
// warnings are orange and red, and blue against them reads for everyone.
const BAR: Record<LimitState, string> = { stuck: "bg-app-error", over: "bg-app-error", watch: "bg-app-warning", ok: "bg-app-info", early: "bg-app-info", idle: "bg-app-border", none: "bg-app-border" };
const PCT_TEXT: Record<LimitState, string> = { stuck: "text-app-error", over: "text-app-error", watch: "text-app-warning", ok: "text-app-text-primary", early: "text-app-text-primary", idle: "text-app-text-secondary", none: "text-app-text-secondary" };
const VERDICT_TEXT: Record<LimitState, string> = { stuck: "text-app-error", over: "text-app-error", watch: "text-app-warning", ok: "text-app-text-secondary", early: "text-app-text-secondary", idle: "text-app-text-secondary", none: "text-app-text-secondary" };
const CHIP: Record<LimitState, string> = {
  stuck: "bg-app-error text-white",
  over: "bg-app-error-soft text-app-error",
  watch: "bg-app-warning-soft text-app-warning",
  ok: "bg-app-success-soft text-app-success",
  early: "bg-app-neutral-soft text-app-text-secondary",
  idle: "bg-app-neutral-soft text-app-text-secondary",
  none: "bg-app-neutral-soft text-app-text-secondary",
};
const STRIPES_COOL = "repeating-linear-gradient(-45deg, #9DB3CB 0 4px, #DCE6F0 4px 8px)";
const STRIPES_HOT = "repeating-linear-gradient(-45deg, #E2A19C 0 4px, #F8E1DF 4px 8px)";
const KPI_CHIP: Record<KpiState, string> = {
  ok: "bg-app-success-soft text-app-success",
  watch: "bg-app-warning-soft text-app-warning",
  off: "bg-app-error-soft text-app-error",
  none: "bg-app-neutral-soft text-app-text-secondary",
};
const VERDICT_CHIP: Record<Verdict, string> = { attention: "bg-app-error text-white", partial: "bg-app-warning-soft text-app-warning", ok: "bg-app-success-soft text-app-success" };

const SQUARE = "inline-block h-3.5 w-3.5 rounded-[3px] box-border";
function squareClass(w: Pick<WindowCell, "hit" | "peakPct">): string {
  if (w.hit) return `${SQUARE} bg-app-error`;
  if (w.peakPct === null) return `${SQUARE} border border-dashed border-app-text-tertiary bg-app-neutral-soft`;
  if (w.peakPct >= 70) return `${SQUARE} bg-app-warning/45`;
  return `${SQUARE} border border-app-info bg-app-info-soft`;
}

const cell = "px-2 py-2 font-jbmono text-[13px] text-app-text-primary";
// One line: the table scrolls sideways in its box, and long headers squeezed into their
// column read a word a line (phone check, 18.11.2026).
const head = "whitespace-nowrap px-2 py-2 text-start font-medium";
const card = "rounded-2xl border border-app-border bg-white";

function fromPace(x: Pace): LimitView {
  return { state: x.state, usedPct: x.usedPct, elapsedPct: x.elapsedPct, projectedPct: x.projectedPct, projectedHitAt: x.projectedHitAt, resetsAt: x.resetsAt, hitAt: null };
}

/// The five-hour window of a person, from the report.
function windowOf(p: PersonUsage): LimitView {
  const c = p.fiveHour.current;
  const blank = { usedPct: null, elapsedPct: null, projectedPct: null, projectedHitAt: null, resetsAt: null, hitAt: null };
  if (c.state === "unknown") return { state: "none", ...blank };
  if (c.state === "idle") return { state: "idle", ...blank };
  if (c.state === "stuck") return { ...blank, state: "stuck", usedPct: 100, elapsedPct: c.pace?.elapsedPct ?? null, resetsAt: c.resetsAt, hitAt: c.hitAt };
  if (c.pace) return fromPace(c.pace);
  // A share with no reset time: no pace, so the share decides.
  const state: LimitState = c.state === "near" ? "over" : c.state === "watch" ? "watch" : "ok";
  return { ...blank, state, usedPct: c.pct, resetsAt: c.resetsAt };
}

/// The weekly limit of a person.
function weekOf(p: PersonUsage): LimitView {
  if (p.fiveHour.weekly) return fromPace(p.fiveHour.weekly);
  const blank = { elapsedPct: null, projectedPct: null, projectedHitAt: null, resetsAt: null, hitAt: null };
  if (p.fiveHour.weeklyPct !== null) return { ...blank, state: p.fiveHour.weeklyPct >= 100 ? "stuck" : "ok", usedPct: p.fiveHour.weeklyPct };
  return { ...blank, state: "none", usedPct: null };
}

/// The person's state: the worse of the two limits. Too early to tell, or
/// no open window, next to a limit that is fine, is fine.
function personState(w: LimitView, k: LimitView): LimitState {
  const worst = RANK[w.state] <= RANK[k.state] ? w.state : k.state;
  if ((worst === "early" || worst === "idle") && (w.state === "ok" || k.state === "ok")) return "ok";
  if (worst === "idle" && k.state === "early") return "early";
  return worst;
}

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
  const clock = (iso: string) => f.dateTime(new Date(iso), { hour: "2-digit", minute: "2-digit" });
  const dayClock = (iso: string) => f.dateTime(new Date(iso), { weekday: "long", hour: "2-digit", minute: "2-digit" });
  const hourLabel = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;
  const none = t("none");
  const nowMs = Date.parse(report.period.to);
  // "in 3:12" within a day; a weekday and an hour beyond it.
  const resetText = (iso: string) => {
    const min = Math.max(0, Math.round((Date.parse(iso) - nowMs) / 60_000));
    return min < 24 * 60 ? t("person.resetsIn", { time: `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}` }) : t("person.resetsOn", { when: dayClock(iso) });
  };
  const sum = report.summary;
  const five = report.fiveHour;

  // Each person's two limits, the closest to getting stuck first.
  const people = report.people
    .map((p) => {
      const w = windowOf(p);
      const k = weekOf(p);
      return { p, w, k, state: personState(w, k) };
    })
    .sort((a, b) => RANK[a.state] - RANK[b.state] || Math.max(b.k.projectedPct ?? 0, b.w.projectedPct ?? 0) - Math.max(a.k.projectedPct ?? 0, a.w.projectedPct ?? 0) || a.p.name.localeCompare(b.p.name));

  // At the top: who is stuck now, and who may get stuck before a reset.
  const stuckNow = people.filter((x) => x.w.state === "stuck" || x.k.state === "stuck");
  const atRisk = people.filter((x) => x.w.state === "over" || x.k.state === "over");
  const riskWhere = (x: (typeof people)[number]) =>
    x.w.state === "over" && x.k.state === "over" ? t("top.where.both") : x.w.state === "over" ? t("top.where.window") : t("top.where.week");
  const names = (xs: typeof people) => xs.map((x) => x.p.name).join(", ");
  const verdictLine = [
    stuckNow.length ? t("top.stuck", { names: names(stuckNow) }) : null,
    atRisk.length ? t("top.atRisk", { names: names(atRisk) }) : null,
    !stuckNow.length && !atRisk.length ? t("top.calm") : null,
    sum.verdict === "partial" ? t("top.missing") : null,
  ]
    .filter(Boolean)
    .join(" ");

  const actionText = (a: (typeof sum.actions)[number]) => {
    // A projected time arrives as an ISO string; the reader gets a day and
    // an hour, or "before the reset" when none was projected.
    const v = "hitAt" in a.values ? { ...a.values, hitAt: a.values.hitAt ? dayClock(String(a.values.hitAt)) : t("person.beforeReset") } : a.values;
    return { title: t(`summary.action.${a.key}.title`, v), detail: t(`summary.action.${a.key}.detail`, v) };
  };

  // One limit's lines under its bar.
  const facts = (l: LimitView) => {
    const parts: string[] = [];
    if (l.hitAt) parts.push(t("person.hitAt", { time: clock(l.hitAt) }));
    if (l.elapsedPct !== null) parts.push(t("person.elapsed", { pct: Math.round(l.elapsedPct) }));
    if (l.resetsAt) parts.push(resetText(l.resetsAt));
    return parts.join(" · ");
  };
  const verdictOf = (l: LimitView, kind: "window" | "week") => {
    switch (l.state) {
      case "stuck":
        return t("person.verdict.stuck");
      case "over":
        return l.projectedHitAt ? t("person.verdict.overAt", { when: dayClock(l.projectedHitAt) }) : t("person.verdict.over");
      case "watch":
        return t("person.verdict.watch", { projected: l.projectedPct ?? 0 });
      case "ok":
        return l.projectedPct === null ? "" : t("person.verdict.ok", { projected: l.projectedPct });
      case "early":
        return t("person.verdict.early");
      case "idle":
        return t("person.verdict.idle");
      case "none":
        return kind === "window" ? t("person.verdict.noneWindow") : t("person.verdict.noneWeek");
    }
  };

  // Where to save: the indicators that are about Ankora's share of the
  // work. Limit hits and the weekly pace are at the top already.
  type SavingKpi = Kpi & { key: "cacheShare" | "duplicateRate" | "avgCallKb" };
  const savingKpis = sum.kpis.filter((k): k is SavingKpi => k.key === "cacheShare" || k.key === "duplicateRate" || k.key === "avgCallKb");
  const sentBytes = report.tools.reduce((n, x) => n + x.totalBytes, 0);
  const topTool = report.tools[0];

  const detailsOpen = Boolean(sp.saved || sp.error);
  const summaryClass = "cursor-pointer list-none text-base font-medium text-app-text-primary [&::-webkit-details-marker]:hidden";

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-medium text-app-text-primary">{t("title")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-app-text-secondary">{t("intro")}</p>
      </header>

      {/* What matters now, in one sentence, with the names. */}
      <section aria-label={t("top.title")} className={`${card} flex flex-wrap items-center gap-3 p-5`} data-testid="usage-summary">
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${VERDICT_CHIP[sum.verdict]}`}>{t(`top.verdict.${sum.verdict}`)}</span>
        <p className="flex-1 basis-80 text-base font-medium text-app-text-primary">{verdictLine}</p>
        {sum.actions.length > 0 && (
          <a href="#todo" className="text-sm font-medium text-app-text-accent underline-offset-4 hover:underline">
            {t("top.todoLink", { count: sum.actions.length })}
          </a>
        )}
      </section>

      <section aria-label={t("top.numbers")} className="grid gap-3 sm:grid-cols-3" data-testid="usage-kpis">
        <div className={`${card} grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-3 p-4 sm:block`}>
          <p className="col-start-2 row-start-1 text-sm text-app-text-secondary">{t("top.stuckNow.label")}</p>
          <p className={`col-start-1 row-span-2 row-start-1 self-center font-jbmono text-3xl sm:mt-1 ${stuckNow.length ? "text-app-error" : "text-app-text-primary"}`}>{int(stuckNow.length)}</p>
          <p className="col-start-2 row-start-2 mt-1 text-xs text-app-text-primary" dir="auto">
            {stuckNow.length
              ? stuckNow
                  .map((x) => {
                    const reset = x.w.state === "stuck" ? x.w.resetsAt : x.k.resetsAt;
                    return reset ? `${x.p.name} · ${resetText(reset)}` : x.p.name;
                  })
                  .join(" · ")
              : t("top.nobody")}
          </p>
        </div>
        <div className={`${card} grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-3 p-4 sm:block`}>
          <p className="col-start-2 row-start-1 text-sm text-app-text-secondary">{t("top.atRiskNow.label")}</p>
          <p className={`col-start-1 row-span-2 row-start-1 self-center font-jbmono text-3xl sm:mt-1 ${atRisk.length ? "text-app-error" : "text-app-text-primary"}`}>{five.measuredNow ? int(atRisk.length) : none}</p>
          <p className="col-start-2 row-start-2 mt-1 text-xs text-app-text-primary" dir="auto">
            {!five.measuredNow ? t("top.atRiskNow.noReadings") : atRisk.length ? atRisk.map((x) => `${x.p.name}: ${riskWhere(x)}`).join(" · ") : t("top.nobody")}
          </p>
        </div>
        <div className={`${card} grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-3 p-4 sm:block`}>
          <p className="col-start-2 row-start-1 text-sm text-app-text-secondary">{t("top.hits.label")}</p>
          <p className="col-start-1 row-span-2 row-start-1 self-center font-jbmono text-3xl text-app-text-primary sm:mt-1">{int(five.hitsThisWeek)}</p>
          <p className="col-start-2 row-start-2 mt-1 text-xs text-app-text-primary">
            {five.peakHours
              ? t("top.hits.peak", { hits: five.peakHours.hits, from: hourLabel(five.peakHours.from), to: hourLabel(five.peakHours.to) })
              : five.hitsThisWeek
                ? t("top.hits.noPeak")
                : t("top.hits.none")}
          </p>
        </div>
      </section>

      {/* Each person: the window and the week as two bars in one language
          (design option א, 19.11.2026). Color is used, the dark mark is the
          time gone, the stripes are where the pace leads by the reset. */}
      <section aria-label={t("person.title")} className="space-y-3" data-testid="usage-five-hour">
        <div>
          <h2 className="text-lg font-medium text-app-text-primary">{t("person.title")}</h2>
          <p className="mt-1 max-w-3xl text-sm text-app-text-secondary">{t("person.about")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-xs text-app-text-secondary" aria-hidden="true">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-7 rounded-full bg-app-info" />
            {t("person.legend.used")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-7 rounded-full" style={{ background: STRIPES_COOL }} />
            {t("person.legend.pace")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-4 w-[3px] rounded bg-app-text-primary" />
            {t("person.legend.time")}
          </span>
        </div>
        <ul className="space-y-3" data-testid="usage-team">
          {people.map(({ p, w, k, state }) => (
            <li key={p.userId} className={`${card} flex flex-wrap items-start gap-x-7 gap-y-4 p-4`}>
              <div className="flex min-w-0 flex-[1_1_10rem] flex-wrap items-center justify-between gap-2 sm:flex-col sm:flex-nowrap sm:items-start sm:justify-start">
                <span className="text-base font-medium text-app-text-primary" dir="auto">
                  {p.name}
                </span>
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${CHIP[state]}`}>{t(`person.state.${state}`)}</span>
              </div>
              {(
                [
                  ["window", w],
                  ["week", k],
                ] as const
              ).map(([kind, l]) => {
                const used = l.usedPct === null ? null : Math.min(100, Math.round(l.usedPct));
                const hot = l.state === "stuck" || l.state === "over";
                const verdict = verdictOf(l, kind);
                return (
                  <div key={kind} className="flex min-w-0 flex-[2_1_16rem] flex-col gap-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium text-app-text-primary">{t(`person.${kind}`)}</span>
                      <span className={`text-sm font-medium ${PCT_TEXT[l.state]}`}>{used === null ? t(`person.short.${l.state === "idle" ? "idle" : "none"}`) : t("person.used", { pct: used })}</span>
                    </div>
                    <div
                      className="relative h-3.5 rounded-full bg-app-neutral-soft"
                      role="img"
                      aria-label={used === null ? `${t(`person.${kind}`)}: ${verdict}` : t("person.aria", { limit: t(`person.${kind}`), used, elapsed: l.elapsedPct === null ? none : Math.round(l.elapsedPct) })}
                    >
                      {l.projectedPct !== null && used !== null && l.state !== "stuck" && (
                        <div className="absolute inset-y-0 start-0 rounded-full" style={{ width: `${Math.min(100, Math.max(used, l.projectedPct))}%`, background: hot ? STRIPES_HOT : STRIPES_COOL }} />
                      )}
                      {used !== null && <div className={`absolute inset-y-0 start-0 rounded-full ${BAR[l.state]}`} style={{ width: `${Math.max(2, used)}%` }} />}
                      {l.elapsedPct !== null && <div className="absolute -inset-y-1 w-[3px] rounded bg-app-text-primary" style={{ insetInlineStart: `calc(${Math.min(100, l.elapsedPct)}% - 1px)` }} />}
                    </div>
                    {facts(l) && <p className="text-xs text-app-text-secondary">{facts(l)}</p>}
                    {verdict && <p className={`text-xs font-medium ${VERDICT_TEXT[l.state]}`}>{verdict}</p>}
                  </div>
                );
              })}
            </li>
          ))}
        </ul>
      </section>

      <section id="todo" aria-label={t("todo.title")} className={`${card} p-5`} data-testid="usage-actions">
        <h2 className="text-lg font-medium text-app-text-primary">{t("todo.title")}</h2>
        {sum.actions.length === 0 ? (
          <p className="mt-2 text-sm text-app-text-secondary">{t("todo.none")}</p>
        ) : (
          <ol className="mt-3 space-y-2">
            {sum.actions.map((a, i) => {
              const text = actionText(a);
              return (
                <li key={`${a.key}-${i}`} className="flex items-start gap-3 rounded-xl bg-app-accent-soft p-3">
                  <span className="inline-flex h-6 w-6 flex-none items-center justify-center rounded-full bg-app-text-accent text-xs font-medium text-white">{i + 1}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-app-text-primary" dir="auto">
                      {text.title}
                    </p>
                    <p className="mt-0.5 text-xs text-app-text-secondary" dir="auto">
                      {text.detail}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section aria-label={t("saving.title")} className="space-y-3" data-testid="usage-saving">
        <div>
          <h2 className="text-lg font-medium text-app-text-primary">{t("saving.title")}</h2>
          <p className="mt-1 max-w-3xl text-sm text-app-text-secondary">{t("saving.about", { days })}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {savingKpis.map((k) => (
            <div key={k.key} className={`${card} flex flex-col gap-1.5 p-4`}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium text-app-text-primary">{t(`saving.kpi.${k.key}.label`)}</p>
                <span className={`flex-none rounded-full px-2.5 py-0.5 text-xs font-medium ${KPI_CHIP[k.state]}`}>{t(`saving.state.${k.state}`)}</span>
              </div>
              {k.value === null ? <p className="text-sm text-app-text-secondary">{t("saving.noData")}</p> : <p className="font-jbmono text-2xl text-app-text-primary">{t(`saving.kpi.${k.key}.value`, { value: k.value })}</p>}
              <p className="text-xs text-app-text-secondary">{t(`saving.kpi.${k.key}.about`)}</p>
              <p className="text-xs text-app-text-secondary">{t(`saving.kpi.${k.key}.target`)}</p>
            </div>
          ))}
          <div className={`${card} flex flex-col gap-1.5 p-4`}>
            <p className="text-sm font-medium text-app-text-primary">{t("saving.topTool.label")}</p>
            {topTool ? (
              <p className="truncate font-jbmono text-lg text-app-text-primary" dir="ltr">
                {topTool.tool}
              </p>
            ) : (
              <p className="text-sm text-app-text-secondary">{t("saving.noData")}</p>
            )}
            <p className="text-xs text-app-text-secondary">
              {topTool ? t("saving.topTool.about", { share: sentBytes ? Math.round((topTool.totalBytes / sentBytes) * 100) : 0, size: bytes(topTool.totalBytes) }) : t("saving.topTool.none")}
            </p>
          </div>
        </div>
      </section>

      {/* The detail, folded. The period applies here only. */}
      <section aria-label={t("details.title")} className="space-y-3" data-testid="usage-details">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-medium text-app-text-primary">{t("details.title")}</h2>
          <nav className="flex items-center gap-2 text-xs text-app-text-secondary" aria-label={t("period", { days })}>
            <span>{t("details.periodLabel")}</span>
            {USAGE_PERIODS.map((d) => (
              <Link
                key={d}
                href={`/app/claude-usage?days=${d}#details`}
                aria-current={d === days ? "page" : undefined}
                className={`tap-area rounded-full border px-3 py-1 text-[12.5px] ${d === days ? "border-gold bg-white font-medium text-app-text-primary" : "border-app-border text-app-text-secondary hover:border-gold"}`}
              >
                {t("periodOption", { days: d })}
              </Link>
            ))}
          </nav>
        </div>
        <p id="details" className="text-xs text-app-text-secondary">
          {t("details.periodNote")}
        </p>

        <details className={`${card} p-4`} data-testid="usage-people">
          <summary className={summaryClass}>
            {t("people.title")} <span className="text-sm font-normal text-app-text-secondary">· {t("details.peopleSub")}</span>
          </summary>
          <p className="mt-2 text-xs text-app-text-secondary">{t("people.costAbout")}</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-app-border text-xs text-app-text-secondary">
                  <th className="min-w-[12rem] py-2 pe-3 text-start font-medium">{t("people.name")}</th>
                  <th className={head}>{t("people.requests")}</th>
                  <th className={head}>{t("people.cost")}</th>
                  <th className={head}>{t("people.limitHits")}</th>
                  <th className={head}>{t("people.window")}</th>
                  <th className={head}>{t("people.cache")}</th>
                  <th className={head}>{t("people.connector")}</th>
                  <th className={head}>{t("people.connectorBytes")}</th>
                  <th className={head}>{t("people.prompts")}</th>
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
        </details>

        <details className={`${card} p-4`} data-testid="usage-week">
          <summary className={summaryClass}>
            {t("details.week.title")} <span className="text-sm font-normal text-app-text-secondary">· {t("details.week.sub")}</span>
          </summary>
          <ul className="mt-3 divide-y divide-app-border">
            {people.map(({ p }) => (
              <li key={p.userId} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <span className="text-sm text-app-text-primary" dir="auto">
                  {p.name}
                </span>
                <span className="flex flex-wrap gap-[3px]" role="img" aria-label={t("details.week.aria", { name: p.name, count: p.fiveHour.week.length, hits: p.fiveHour.hitsThisWeek })}>
                  {p.fiveHour.week.length === 0 ? (
                    <span className="text-xs text-app-text-tertiary">{t("details.week.none")}</span>
                  ) : (
                    p.fiveHour.week.map((w) => <span key={w.start} className={squareClass(w)} title={`${when(w.start)}: ${w.hit ? t("details.week.hit") : w.peakPct === null ? t("details.week.unknown") : `${w.peakPct}%`}`} />)
                  )}
                </span>
              </li>
            ))}
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
                {t(`details.week.legend.${key}`)}
              </span>
            ))}
          </div>
        </details>

        <details className={`${card} p-4`} data-testid="usage-tools">
          <summary className={summaryClass}>
            {t("tools.title")} <span className="text-sm font-normal text-app-text-secondary">· {t("details.toolsSub")}</span>
          </summary>
          <p className="mt-2 text-xs text-app-text-secondary">{t("tools.intro")}</p>
          <p className="mt-1 text-xs text-app-text-secondary">
            {t("details.signals", { briefThenFile: report.signals.briefThenFile, duplicates: report.signals.duplicateReads, truncated: report.signals.truncatedAnswers })}
          </p>
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
        </details>

        <details className={`${card} p-4`} data-testid="usage-prompts">
          <summary className={summaryClass}>
            {t("prompts.title")} <span className="text-sm font-normal text-app-text-secondary">· {t("details.promptsSub")}</span>
          </summary>
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
        </details>

        <details className={`${card} p-4`} data-testid="usage-heavy">
          <summary className={summaryClass}>
            {t("heavy.title")} <span className="text-sm font-normal text-app-text-secondary">· {t("details.heavySub")}</span>
          </summary>
          <p className="mt-2 text-xs text-app-text-secondary">{t("heavy.intro")}</p>
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
        </details>

        <details id="settings" open={detailsOpen} className={`${card} p-4`} data-testid="usage-settings">
          <summary className={summaryClass}>
            {t("settings.title")} <span className="text-sm font-normal text-app-text-secondary">· {t("details.settingsSub")}</span>
          </summary>
          <p className="mt-2 text-xs text-app-text-secondary">{t("settings.intro")}</p>
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
            <div className="grid gap-2 lg:grid-cols-2">
              {report.people.map((p) => (
                <fieldset key={p.userId} className="space-y-2 rounded-lg border border-app-border px-3 py-2 text-sm text-app-text-primary" data-testid={`usage-settings-${p.userId}`}>
                  <legend className="px-1 font-medium" dir="auto">
                    {p.name}
                  </legend>
                  <input type="hidden" name={`listed:${p.userId}`} value="1" />
                  <label className="tap-area flex items-center gap-2">
                    <input type="checkbox" name={`nonCowork:${p.userId}`} defaultChecked={p.nonCowork} className="h-4 w-4" />
                    <span>{t("settings.nonCowork")}</span>
                  </label>
                  <label className="block space-y-1">
                    <span className="text-xs text-app-text-secondary">{t("settings.aliases")}</span>
                    <input
                      type="text"
                      name={`aliases:${p.userId}`}
                      dir="ltr"
                      inputMode="email"
                      autoComplete="off"
                      defaultValue={(report.settings.aliases[p.userId] ?? []).join(", ")}
                      placeholder="name@example.com"
                      className="w-full rounded-lg border border-app-border bg-white px-2 py-1.5 text-sm"
                    />
                  </label>
                </fieldset>
              ))}
            </div>
            <button type="submit" className="tap-area rounded-full border border-app-border bg-white px-4 py-1.5 text-[12.5px] font-medium text-app-text-primary hover:border-gold">
              {t("settings.save")}
            </button>
          </form>
        </details>
      </section>

      <footer className="space-y-1 text-xs text-app-text-secondary" data-testid="usage-coverage">
        <p>{t("coverage.line", { events: int(report.coverage.coworkEvents), calls: int(report.coverage.toolCalls), copies: int(report.coverage.promptCopies) })}</p>
        {report.coverage.unmatchedEmails.length > 0 && <p dir="auto">{t("coverage.unmatched", { emails: report.coverage.unmatchedEmails.join(", ") })}</p>}
        {report.coverage.unmatchedLimitEmails.length > 0 && <p dir="auto">{t("coverage.unmatchedLimits", { emails: report.coverage.unmatchedLimitEmails.join(", ") })}</p>}
      </footer>
    </div>
  );
}
