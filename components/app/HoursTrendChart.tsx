"use client";

import { useId, useMemo, useState } from "react";
import type { HoursTrendData, TrendDimension, TrendUnit } from "@/lib/app-domain/overview-trend";

/// Overview home-page widget (Ariel's request, redesign direction A
/// follow-up). Design direction A of three proposed mockups, approved by
/// Ariel: "מינימלי אדיטוריאלי" - thin rounded-top bars, a muted
/// dark-to-light navy ramp (gold reserved for the "אחר" bucket only), and
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

const NAVY_SHADES = ["#1B2A3D", "#2F4257", "#4C6178", "#7791A3", "#A8BAC5"];
const OTHER_COLOR = "#B08D57";
const OTHER_KEY = "__other__";

function colorFor(key: string, index: number): string {
  return key === OTHER_KEY ? OTHER_COLOR : NAVY_SHADES[index % NAVY_SHADES.length];
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
    <div className="flex shrink-0 rounded-lg bg-paperDim p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          aria-pressed={value === opt.value}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            value === opt.value ? "bg-navy text-paper" : "text-navy/55 hover:text-navy"
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
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const tooltipBaseId = useId();

  const series = data[unit][dimension];

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
          <p className="text-sm text-navy/60">
            שעות מדווחות · {unit === "day" ? "7 הימים האחרונים" : "7 השבועות האחרונים"}
          </p>
          <p className="mt-1 text-3xl font-medium text-navy">
            {formatHours(grandTotal)} <span className="text-base font-normal text-navy/50">שעות</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
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
            ]}
          />
        </div>
      </div>

      {!hasData ? (
        <p className="mt-8 py-8 text-center text-sm text-navy/50">אין נתוני שעות בתקופה זו.</p>
      ) : (
        <>
          <div dir="ltr" className="mt-8 flex h-48 items-end gap-2 sm:gap-4" role="img" aria-label={`גרף שעות מדווחות, ${series.buckets.map((b) => `${b.label}: ${formatHours(b.segments.reduce((s, x) => s + x.hours, 0))} שעות`).join(", ")}`}>
            {series.buckets.map((bucket, i) => {
              const total = totalsPerBucket[i];
              const barHeightPct = Math.max(2, (total / maxTotal) * 100);
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
                      className="absolute bottom-full z-10 mb-2 w-max max-w-[200px] rounded-lg bg-navy px-3 py-2 text-xs text-paper shadow-lg"
                    >
                      <p className="mb-1 font-medium">{bucket.label}</p>
                      {bucket.segments
                        .filter((s) => s.hours > 0)
                        .map((s, si) => (
                          <div key={s.key} className="flex items-center gap-1.5 text-paper/85">
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
              <span key={bucket.label + i} className="flex-1 truncate text-[11px] text-navy/45">
                {bucket.label}
              </span>
            ))}
          </div>

          <div className="mt-6 flex flex-wrap justify-center gap-x-4 gap-y-2 border-t border-lineDark pt-4">
            {series.legend.map((l, i) => (
              <div key={l.key} className="flex items-center gap-1.5 text-xs text-navy/70">
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
