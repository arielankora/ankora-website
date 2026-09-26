// App redesign (handoff README, "Design Tokens"): "bg-gold-gradient:
// ... מילוי פסי ניצול" - the gold gradient is the default utilization-bar
// fill everywhere in the app. `dangerAt` (used by Home's bank-utilization
// KPI and the Hour Banks screen: "פס ניצול שהופך אדום מעל 100%") switches
// the fill to the error token once `percent` reaches it.
export function ProgressBar({
  percent,
  dangerAt,
  markerAt,
  className = "",
}: {
  percent: number;
  dangerAt?: number;
  /// A thin tick where the bar is expected to be by now (26.9.2026, the
  /// Home bank card's pace). Relative, so it never needs a legend: ahead
  /// of the tick is ahead of the pace.
  markerAt?: number;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  const isDanger = dangerAt != null && percent >= dangerAt;
  const bar = (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-lineDark/60 ${markerAt == null ? className : ""}`}>
      <div
        className={`h-full rounded-full ${isDanger ? "bg-error" : "bg-gold-gradient"}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
  if (markerAt == null) return bar;
  const marker = Math.max(0, Math.min(100, markerAt));
  return (
    <div className={`relative ${className}`}>
      {bar}
      {/* insetInlineStart, so the tick sits on the same side the fill
          grows from in a right-to-left page. */}
      <span
        aria-hidden
        data-testid="progress-marker"
        className="absolute -top-1 h-3.5 w-0.5 -translate-x-1/2 rounded-full bg-appNavy/70 rtl:translate-x-1/2"
        style={{ insetInlineStart: `${marker}%` }}
      />
    </div>
  );
}
