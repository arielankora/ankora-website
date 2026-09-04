const TONE_CLASSES: Record<"green" | "amber" | "gray" | "red", string> = {
  green: "bg-emerald-50 text-emerald-700",
  amber: "bg-amber-50 text-amber-700",
  gray: "bg-navy/5 text-navy/50",
  red: "bg-red-50 text-red-700",
};

export function StatusBadge({ label, tone }: { label: string; tone: "green" | "amber" | "gray" | "red" }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${TONE_CLASSES[tone]}`}>
      {label}
    </span>
  );
}
