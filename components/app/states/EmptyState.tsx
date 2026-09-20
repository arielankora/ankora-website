import Link from "next/link";
import type { LucideIcon } from "lucide-react";

// App redesign (handoff README, "19. מצבי מסך"): the mandatory empty-state
// template for every list screen - title + one sentence + one primary
// action. Shared here so every screen (Clients, Tasks, Categories,
// Important Dates, Time Entries, Alerts, ...) gets the same shape instead
// of a bespoke "אין תוצאות" paragraph each.
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: { label: string; href: string } | { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-lineDark bg-white px-6 py-14 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-gold/10">
        <Icon size={20} strokeWidth={1.75} className="text-gold-dim" />
      </span>
      <p className="text-[15px] font-medium text-appNavy">{title}</p>
      <p className="max-w-sm text-sm text-appNavy/60">{description}</p>
      {action &&
        ("href" in action ? (
          <Link
            href={action.href}
            className="mt-2 rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-navy"
          >
            {action.label}
          </Link>
        ) : (
          <button
            type="button"
            onClick={action.onClick}
            className="mt-2 rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-navy"
          >
            {action.label}
          </button>
        ))}
    </div>
  );
}
