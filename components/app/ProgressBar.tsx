// App redesign (handoff README, "Design Tokens"): "bg-gold-gradient:
// ... מילוי פסי ניצול" - the gold gradient is the default utilization-bar
// fill everywhere in the app. `dangerAt` (used by Home's bank-utilization
// KPI and the Hour Banks screen: "פס ניצול שהופך אדום מעל 100%") switches
// the fill to the error token once `percent` reaches it.
export function ProgressBar({
  percent,
  dangerAt,
  className = "",
}: {
  percent: number;
  dangerAt?: number;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  const isDanger = dangerAt != null && percent >= dangerAt;
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-lineDark/60 ${className}`}>
      <div
        className={`h-full rounded-full ${isDanger ? "bg-error" : "bg-gold-gradient"}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
