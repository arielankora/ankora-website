import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

type KpiCardProps = {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  href?: string;
  footer?: ReactNode;
};

/// Redesign direction A follow-up: Ariel flagged the Overview KPI cards'
/// icons as "small and stuck in the corner" - each card used to render a
/// bare 18px icon as its own first child above the number, with no
/// container giving it visual weight, so in RTL it just floated alone at
/// the card's top-right with a lot of empty space around it.
///
/// This gives every KPI card the same professional stat-card shape (label
/// + a proper circular icon badge on one row, the big number promoted
/// below it) instead of hand-copying similar-but-drifting markup 8 times
/// across page.tsx - one shared component, one guaranteed-consistent look.
export function KpiCard({ icon: Icon, label, value, href, footer }: KpiCardProps) {
  const content = (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-navy/60">{label}</p>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold/10">
          <Icon size={18} strokeWidth={1.75} className="text-gold-dim" />
        </span>
      </div>
      <p className="mt-4 text-3xl font-medium text-navy">{value}</p>
      {footer}
    </>
  );

  const className = `block rounded-2xl border border-lineDark bg-white p-6 transition-colors${
    href ? " hover:border-gold" : ""
  }`;

  if (href) {
    return (
      <Link href={href} className={className}>
        {content}
      </Link>
    );
  }
  return <div className={className}>{content}</div>;
}
