"use client";

import { useId, useMemo, useState } from "react";
import type { HoursTrendData, TrendBasis, TrendDimension, TrendUnit } from "@/lib/app-domain/overview-trend";

/// Overview home-page widget (Ariel's request, redesign direction A
/// follow-up). Design direction A of three proposed mockups, approved by
/// Ariel: "מינימלי אדיטוריאלי" - thin rounded-top bars, a muted
/// navy/slate palette (gold reserved for the "אחר" bucket only), and
/// a plain text-chip legend under the chart rather than a busy built-in
/// legend widget. Both unit x dimension combinations are precomputed
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
const SERIES_COLORS = ["#1B2A3D", "#4A78A6", "#7FA89C", "#A9BCCB", "#8E7FA6"];
const OTHER_COLOR = "#B08D57";
const OTHER_KEY = "__other__";

function colorFor(key: string, index: number): string {
  return key === OTHER_KEY ? OTHER_COLOR : SERIES_COLORS[index % SERIES_COLORS.length];
}

function formatHours(hours: number): string {
  const rounded = Math.round(hours * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
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
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            value === opt.value ? "bg-appNavy text-cream" : "text-appNavy/55 hover:text-appNavy"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function HoursTrendChart({ data }: { data: HoursTrendData }) {
  const [unit, setUnit] = useState<TrendUnit>("day");
  const [dimension, setDimension] = useState<TrendDimension>("employee");
  const [basis, setBasis] = useState<TrendBasis>("actual");
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const tooltipBaseId = useId();

  const series = data[basis][unit][dimension];

  const totalsPerBucket = useMemo(
    () => series.buckets.map((b) => b.segments.reduce((sum, s) => sum + s.hours, 0)),
    [series]
  );
  const maxTotal = Math.max(1, ...totalsPerBucket);
  const grandTotal = totalsPerBucket.reduce((a, b) => a + b, 0);
  const hasData = grandTotal > 0;

  return (
    <div className="rounded-2xl border border-lineDark bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-appNavy/60">
            {basis === "actual" ? "שעות בפועל" : "שעות לחיוב"} ·{" "}
            {unit === "day" ? "14 הימים האחרונים" : "7 השבועות האחרונים, כולל השבוע"}
          </p>
          <p className="mt-1 text-3xl font-medium text-appNavy">
            {formatHours(grandTotal)} <span className="text-base font-normal text-appNavy/50">שעות</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <SegToggle
            value={basis}
            onChange={setBasis}
            options={[
              { value: "actual", label: "בפועל" },
              { value: "billable", label: "לחיוב" },
            ]}
          />
          <SegToggle
            value={unit}
            onChange={setUnit}
            options={[
              { value: "day", label: "ימים" },
              { value: "week", label: "שבועות" },
            ]}
          />
          <SegToggle
            value={dimension}
            onChange={setDimension}
            options={[
              { value: "employee", label: "לפי עובד" },
              { value: "client", label: "לפי לקוח" },
              { value: "category", label: "לפי קטגוריה" },
            ]}
          />
        </div>
      </div>

      {!hasData ? (
        <p className="mt-8 py-8 text-center text-sm text-appNavy/50">אין נתוני שעות בתקופה זו.</p>
      ) : (
        <>
          <div dir="ltr" className="mt-8 flex h-48 items-end gap-2 sm:gap-4" role="img" aria-label={`גרף שעות מדווחות, ${series.buckets.map((b) => `${b.label}: ${formatHours(b.segments.reduce((s, x) => s + x.hours, 0))} שעות`).join(", ")}`}>
            {series.buckets.map((bucket, i) => {
              const total = totalsPerBucket[i];
              const barHeightPct = Math.max(2, (total / maxTotal) * 82);
              return (
                <div
                  key={bucket.label + i}
                  className="relative flex h-full flex-1 flex-col items-center justify-end"
                  onMouseEnter={() => setHoverIdx(i)}
                  onMouseLeave={() => setHoverIdx(null)}
                  onFocus={() => setHoverIdx(i)}
                  onBlur={() => setHoverIdx(null)}
                  tabIndex={0}
                >
                  {hoverIdx === i && (
                    <div
                      id={`${tooltipBaseId}-${i}`}
                      dir="rtl"
                      className="absolute bottom-full z-10 mb-2 w-max max-w-[200px] rounded-lg bg-appNavy px-3 py-2 text-xs text-cream shadow-lg"
                    >
                      <p className="font-medium">{bucket.label}</p>
                      <p className="mb-1 text-cream/60">
                        {bucket.range}
                        {bucket.partial ? " · עד עכשיו" : ""}
                      </p>
                      {bucket.segments
                        .filter((s) => s.hours > 0)
                        .map((s, si) => (
                          <div key={s.key} className="flex items-center gap-1.5 text-cream/85">
                            <span
                              className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                              style={{ background: colorFor(s.key, series.legend.findIndex((l) => l.key === s.key)) }}
                            />
                            <span className="flex-1">{s.name}</span>
                            <span className="font-medium">{formatHours(s.hours)}</span>
                          </div>
                        ))}
                    </div>
                  )}
                  {total > 0 && (
                    <span className="mb-1 text-[10px] font-medium text-appNavy/55">{formatHours(total)}</span>
                  )}
                  <div
                    className="flex w-full max-w-[30px] flex-col-reverse overflow-hidden rounded-t-[5px]"
                    // A running day or week is drawn lighter: its total is
                    // still growing and should not read as a slow period.
                    style={{ height: `${barHeightPct}%`, opacity: bucket.partial ? 0.5 : 1 }}
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
              );
            })}
          </div>
          <div dir="ltr" className="mt-2 flex gap-2 sm:gap-4 text-center">
            {series.buckets.map((bucket, i) => (
              <span key={bucket.label + i} className="flex flex-1 flex-col truncate text-[11px] text-appNavy/45">
                <span className="truncate">{bucket.label}</span>
                <span className="truncate text-[10px] text-appNavy/35">{bucket.range}</span>
              </span>
            ))}
          </div>

          <div className="mt-6 flex flex-wrap justify-center gap-x-4 gap-y-2 border-t border-lineDark pt-4">
            {series.legend.map((l, i) => (
              <div key={l.key} className="flex items-center gap-1.5 text-xs text-appNavy/70">
                <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: colorFor(l.key, i) }} />
                {l.name}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
