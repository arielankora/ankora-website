"use client";

import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { OTHER_KEY } from "@/lib/overview-trend-key";
import type {
  HoursTrendData,
  TrendBasis,
  TrendBucket,
  TrendDimension,
  TrendLabel,
  TrendUnit,
} from "@/lib/app-domain/overview-trend";

/// Overview home-page widget (Ariel's request, redesign direction A
/// follow-up). Design direction A of three proposed mockups, approved by
/// Ariel: "מינימלי אדיטוריאלי" - thin rounded-top bars, a muted
/// navy/slate palette (gold reserved for the "אחר" bucket only), and
/// a plain text-chip legend under the chart rather than a busy built-in
/// legend widget. Every unit x dimension combination is precomputed
/// server-side (see getHoursTrend) and passed in as `data`, so toggling
/// here is instant local state - no client fetch, no loading flicker.
///
/// The plotting row is deliberately forced `dir="ltr"` (oldest bucket on
/// the left, most recent on the right) even though the rest of the card is
/// Hebrew/RTL - reversing a time series so it reads newest-to-oldest
/// left-to-right is the one place strict RTL mirroring actively hurts
/// comprehension of a trend, and every RTL analytics product (Similarweb,
/// Wix Analytics, etc.) keeps this convention for the same reason.

// Five series colors that stay apart from each other, still inside the
// navy/slate family of the app. The original ramp was five shades of one
// navy, and its two darkest (#0F1B29, #1B2A3D) could not be told apart:
// on "לפי עובד" Ariel and Hadas looked like a single block (9.10.2026).
// Each step now changes hue as well as lightness.
// No series may be navy: the tooltip sits on bg-app-surface-nav (#1B2A3D),
// and a navy dot vanished there, so the top client had no marker in the
// tooltip (15.11.2026). The first color is a terracotta that reads on both
// the navy tooltip (3.5:1) and the white card (4.1:1).
const SERIES_COLORS = ["#B9674F","#4A78A6", "#7FA89C", "#A9BCCB", "#8E7FA6"];
const OTHER_COLOR = "#B08D57";

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const MONTH_KEYS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] as const;

/// At most this many empty days are drawn after today in the day view, so
/// today can scroll to the middle of the strip on a phone.
const MAX_UPCOMING_DAYS = 7;

function addDaysToKey(dateKey: string, days: number): string {
  const d = dateOfKey(dateKey);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function colorFor(key: string, index: number): string {
  return key === OTHER_KEY ? OTHER_COLOR : SERIES_COLORS[index % SERIES_COLORS.length];
}

/// A `YYYY-MM-DD` key as a Date at UTC midnight, formatted in UTC below, so
/// the calendar day never moves with the reader's time zone.
function dateOfKey(dateKey: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function SegToggle<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex shrink-0 rounded-lg bg-cream-dim p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          aria-pressed={value === opt.value}
          className={`tap-area rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            value === opt.value ? "bg-app-surface-nav text-cream" : "text-app-text-secondary hover:text-app-text-primary"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function HoursTrendChart({ data }: { data: HoursTrendData }) {
  const t = useTranslations("home.trend");
  const format = useFormatter();
  // The plot row is forced left to right; the tooltip inside it reads in
  // the page's own direction.
  const textDir = useLocale().startsWith("he") ? "rtl" : "ltr";

  // One decimal at most, no thousands separator: the Hebrew read "1234.5"
  // before ADR 0006 and still does.
  const formatHours = (hours: number) =>
    format.number(Math.round(hours * 10) / 10, { maximumFractionDigits: 1, useGrouping: false });

  const labelOf = (label: TrendLabel): string => {
    if (label.kind === "day") {
      const day = t(`weekdays.${WEEKDAY_KEYS[label.weekday]}`);
      return label.current ? t("today", { day }) : day;
    }
    if (label.kind === "month") {
      const month = t(`months.${MONTH_KEYS[label.month]}`);
      return label.current ? t("thisMonth", { month }) : month;
    }
    return t("weeksAgo", { count: label.weeksAgo });
  };

  const shortDay = (dateKey: string) =>
    format.dateTime(dateOfKey(dateKey), { day: "numeric", month: "numeric", timeZone: "UTC" });
  const rangeOf = (bucket: TrendBucket): string =>
    bucket.firstDay === bucket.lastDay ? shortDay(bucket.firstDay) : `${shortDay(bucket.firstDay)} - ${shortDay(bucket.lastDay)}`;
  const nameOf = (s: { key: string; name: string }) => (s.key === OTHER_KEY ? t("other") : s.name);

  const [unit, setUnit] = useState<TrendUnit>("day");
  const [dimension, setDimension] = useState<TrendDimension>("employee");
  const [basis, setBasis] = useState<TrendBasis>("actual");
  // The tooltip lives outside the scrolling strip (a scroll box would clip
  // it), so it is placed by the hovered column's center, measured against
  // the wrapper.
  const [hover, setHover] = useState<{ idx: number; x: number } | null>(null);
  const tooltipBaseId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const series = data[basis][unit][dimension];

  // The bar to center: today, this week or this month, which is always the
  // last bucket the server sends.
  const focusIdx = series.buckets.length - 1;
  const lastDayKey = series.buckets[focusIdx]?.lastDay;
  // How many empty days follow today: just enough for today to reach the
  // middle of the strip, and none when every bar fits without scrolling
  // (a wide screen), where they would only be blank space.
  const [upcomingCount, setUpcomingCount] = useState(0);
  const upcomingDays = useMemo(
    () =>
      unit === "day" && lastDayKey
        ? Array.from({ length: upcomingCount }, (_, k) => addDaysToKey(lastDayKey, k + 1))
        : [],
    [unit, lastDayKey, upcomingCount]
  );

  // A week's column carries a date range ("25.10 - 31.10") and needs more
  // room than a day's.
  const colMinWidth = unit === "week" ? "min-w-[76px]" : "min-w-[56px]";

  const showHover = (idx: number, el: HTMLElement) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const a = el.getBoundingClientRect();
    const w = wrap.getBoundingClientRect();
    // Keep the 200px tooltip inside the card at both ends of the strip.
    const half = Math.min(100, w.width / 2);
    const x = Math.min(Math.max(a.left + a.width / 2 - w.left, half), w.width - half);
    setHover({ idx, x });
  };

  useLayoutEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    const measure = () => {
      const col = box.querySelector<HTMLElement>(`[data-trend-col="${focusIdx}"]`);
      if (!col) return;
      const gap = parseFloat(getComputedStyle(box).columnGap) || 0;
      const overflows = col.offsetLeft + col.offsetWidth > box.clientWidth + 1;
      setUpcomingCount(
        unit === "day" && overflows
          ? Math.min(MAX_UPCOMING_DAYS, Math.ceil((box.clientWidth / 2 - col.offsetWidth / 2) / (col.offsetWidth + gap)))
          : 0
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, [unit, focusIdx]);

  useLayoutEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    const col = box.querySelector<HTMLElement>(`[data-trend-col="${focusIdx}"]`);
    if (!col) return;
    box.scrollLeft = col.offsetLeft + col.offsetWidth / 2 - box.clientWidth / 2;
    setHover(null);
  }, [unit, basis, dimension, focusIdx, upcomingCount]);

  const totalsPerBucket = useMemo(
    () => series.buckets.map((b) => b.segments.reduce((sum, s) => sum + s.hours, 0)),
    [series]
  );
  const maxTotal = Math.max(1, ...totalsPerBucket);
  const grandTotal = totalsPerBucket.reduce((a, b) => a + b, 0);
  const hasData = grandTotal > 0;

  return (
    <div className="rounded-2xl border border-app-border bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-app-text-secondary">
            {t(`basisTitle.${basis}`)} · {t(`period.${unit}`)}
          </p>
          <p className="mt-1 text-3xl font-medium text-app-text-primary">
            {formatHours(grandTotal)} <span className="text-base font-normal text-app-text-tertiary">{t("hours")}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <SegToggle
            value={basis}
            onChange={setBasis}
            options={[
              { value: "actual", label: t("basis.actual") },
              { value: "billable", label: t("basis.billable") },
            ]}
          />
          <SegToggle
            value={unit}
            onChange={setUnit}
            options={[
              { value: "day", label: t("unit.day") },
              { value: "week", label: t("unit.week") },
              { value: "month", label: t("unit.month") },
            ]}
          />
          <SegToggle
            value={dimension}
            onChange={setDimension}
            options={[
              { value: "employee", label: t("dimension.employee") },
              { value: "client", label: t("dimension.client") },
              { value: "category", label: t("dimension.category") },
            ]}
          />
        </div>
      </div>

      {!hasData ? (
        <p className="mt-8 py-8 text-center text-sm text-app-text-tertiary">{t("empty")}</p>
      ) : (
        <>
          {/* One horizontal strip that scrolls on its own, bars and labels
              together, so a finger can swipe back through the days. Every
              column keeps a readable width instead of shrinking to fit: on
              a phone the 14 day bars were squeezed until the labels read
              "..." and today was cut off at the edge (17.11.2026). On
              opening, and on every toggle, the strip centers on today (or
              on the running week or month). */}
          <div ref={wrapRef} className="relative mt-8">
            {hover && (() => {
              const bucket = series.buckets[hover.idx];
              if (!bucket) return null;
              return (
                <div
                  id={`${tooltipBaseId}-${hover.idx}`}
                  dir={textDir}
                  className="pointer-events-none absolute bottom-full z-10 mb-2 w-max max-w-[200px] -translate-x-1/2 rounded-lg bg-app-surface-nav px-3 py-2 text-xs text-cream shadow-lg"
                  style={{ left: hover.x }}
                >
                  <p className="font-medium">{labelOf(bucket.label)}</p>
                  <p className="mb-1 text-cream/60">
                    {rangeOf(bucket)}
                    {bucket.partial ? ` · ${t("soFar")}` : ""}
                  </p>
                  {bucket.segments
                    .filter((s) => s.hours > 0)
                    .map((s) => (
                      <div key={s.key} className="flex items-center gap-1.5 text-cream/85">
                        <span
                          className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ background: colorFor(s.key, series.legend.findIndex((l) => l.key === s.key)) }}
                        />
                        <span dir="auto" className="flex-1">{nameOf(s)}</span>
                        <span className="font-medium">{formatHours(s.hours)}</span>
                      </div>
                    ))}
                </div>
              );
            })()}
            <div
              ref={scrollRef}
              dir="ltr"
              data-trend-scroll
              onScroll={() => setHover(null)}
              className="relative flex gap-2 overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:thin] sm:gap-4"
              role="img"
              aria-label={t("chartLabel", {
                bars: series.buckets
                  .map((b) => t("barLabel", { label: labelOf(b.label), hours: formatHours(b.segments.reduce((s, x) => s + x.hours, 0)) }))
                  .join(", "),
              })}
            >
              {series.buckets.map((bucket, i) => {
                const total = totalsPerBucket[i];
                const barHeightPct = Math.max(2, (total / maxTotal) * 82);
                return (
                  <div
                    key={i}
                    data-trend-col={i}
                    data-current={i === focusIdx ? "" : undefined}
                    className={`flex ${colMinWidth} flex-1 flex-col items-center`}
                    // A finger has no hover: a tap opens the tooltip, and the
                    // leave a touch browser fires right after it is ignored.
                    onPointerEnter={(e) => e.pointerType === "mouse" && showHover(i, e.currentTarget)}
                    onPointerLeave={(e) => e.pointerType === "mouse" && setHover(null)}
                    onClick={(e) => showHover(i, e.currentTarget)}
                    onFocus={(e) => showHover(i, e.currentTarget)}
                    onBlur={() => setHover(null)}
                    tabIndex={0}
                    aria-describedby={hover?.idx === i ? `${tooltipBaseId}-${i}` : undefined}
                  >
                    <div className="flex h-48 w-full flex-col items-center justify-end">
                      {total > 0 && (
                        <span className="mb-1 text-[10px] font-medium text-app-text-secondary">{formatHours(total)}</span>
                      )}
                      {/* A running day or week keeps its colors and gets a thin
                          dashed cap instead: "still growing". It used to be
                          drawn at half opacity, which changed every color in
                          it - Hadas turned grey, Ariel light blue - so the bar
                          no longer matched the legend and seemed to show other
                          people (9.10.2026). The label and dates under the bar
                          already say the period is not over. */}
                      {bucket.partial && total > 0 && (
                        <div
                          aria-hidden
                          data-partial-cap
                          className="mb-[3px] w-full max-w-[30px] border-t-2 border-dashed border-app-border-strong"
                        />
                      )}
                      <div
                        className="flex w-full max-w-[30px] flex-col-reverse overflow-hidden rounded-t-[5px]"
                        style={{ height: `${barHeightPct}%` }}
                      >
                        {bucket.segments
                          .filter((s) => s.hours > 0)
                          .map((s) => (
                            <div
                              key={s.key}
                              style={{
                                background: colorFor(s.key, series.legend.findIndex((l) => l.key === s.key)),
                                height: `${(s.hours / total) * 100}%`,
                                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.55)",
                              }}
                            />
                          ))}
                      </div>
                    </div>
                    {/* The row is ltr on purpose (oldest on the left); the labels under the bars
                        are words in the page's language and get its direction back, so "ראשון
                        (היום)" is Hebrew text, not ltr text (iPhone check, 22.11.2026). */}
                    <span
                      dir={textDir}
                      className={`mt-2 flex w-full flex-col text-center text-[11px] ${
                        i === focusIdx ? "font-medium text-app-text-primary" : "text-app-text-tertiary"
                      }`}
                    >
                      <span className="line-clamp-2 leading-tight">{labelOf(bucket.label)}</span>
                      <span className="truncate text-[10px] text-app-text-tertiary">{rangeOf(bucket)}</span>
                    </span>
                  </div>
                );
              })}
              {/* Days still ahead this week and a bit, empty and muted, so
                  today can sit in the middle of the strip instead of at its
                  edge. Only in the day view: a coming week or month has
                  no use there. */}
              {/* The faded look is on the empty bar only: a label at half
                  opacity fails the contrast check (2.08:1), which shows once
                  the strip fits its card and these days are on screen. */}
              {upcomingDays.map((dateKey) => (
                <div key={dateKey} aria-hidden className="flex min-w-[56px] flex-1 flex-col items-center">
                  <div className="flex h-48 w-full items-end justify-center opacity-50">
                    <div className="w-full max-w-[30px] border-t border-dashed border-app-border" />
                  </div>
                  <span dir={textDir} className="mt-2 flex w-full flex-col text-center text-[11px] text-app-text-tertiary">
                    <span className="truncate">{t(`weekdays.${WEEKDAY_KEYS[dateOfKey(dateKey).getUTCDay()]}`)}</span>
                    <span className="truncate text-[10px]">{shortDay(dateKey)}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 flex flex-wrap justify-center gap-x-4 gap-y-2 border-t border-app-border pt-4">
            {series.legend.map((l, i) => (
              <div key={l.key} className="flex items-center gap-1.5 text-xs text-app-text-secondary">
                <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: colorFor(l.key, i) }} />
                <span dir="auto">{nameOf(l)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
