"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  Home,
  Timer,
  History,
  Users,
  Tag,
  ListChecks,
  UserCog,
  Wallet,
  Bell,
  BarChart3,
  CalendarClock,
  ScrollText,
  BookOpen,
  LayoutDashboard,
  CalendarDays,
  FileText,
  MoreHorizontal,
  LogOut,
  type LucideIcon,
} from "lucide-react";

// Spec 11.1: "Bottom navigation עם 3-5 יעדים בלבד." AppShell.tsx computes
// the full, role-filtered `items` list (2 items for a bare employee, up to
// 9 for SUPER_ADMIN) - this component is what turns that into a real
// bottom tab bar rather than the old header hamburger. To honor "3-5"
// literally no matter how long a given role's nav is, it always shows at
// most the first 4 items as direct tabs plus a 5th "עוד" (more) tab; "עוד"
// opens a sheet with whatever didn't fit plus the account/sign-out block
// the old hamburger used to show. See ADR addendum section 14.5.
const ICONS: Record<string, LucideIcon> = {
  "/app": Home,
  "/app/timer": Timer,
  "/app/my-time": History,
  "/app/clients": Users,
  "/app/categories": Tag,
  "/app/time-entries": ListChecks,
  "/app/users": UserCog,
  "/app/hour-banks": Wallet,
  "/app/alerts": Bell,
  "/app/reports": BarChart3,
  "/app/report-schedules": CalendarClock,
  "/app/audit-log": ScrollText,
  "/app/guide": BookOpen,
  "/app/portal": LayoutDashboard,
  "/app/portal/weekly": CalendarDays,
  "/app/portal/monthly": FileText,
  "/app/portal/history": History,
};

export function BottomNav({
  items,
  userName,
  roleLabel,
}: {
  items: { href: string; label: string }[];
  userName: string;
  roleLabel: string;
}) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const direct = items.slice(0, 4);
  const overflow = items.slice(4);

  function isActive(href: string) {
    return href === "/app" ? pathname === "/app" : pathname.startsWith(href);
  }

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-lineDark bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
      aria-label="ניווט ראשי"
    >
      <div className="grid grid-cols-5">
        {direct.map((item) => {
          const Icon = ICONS[item.href] ?? Home;
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex min-h-[56px] flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] ${
                active ? "text-navy" : "text-navy/50"
              }`}
            >
              <Icon size={20} strokeWidth={active ? 2.25 : 1.75} />
              <span className="max-w-full truncate">{item.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-label="עוד אפשרויות"
          aria-expanded={moreOpen}
          className="flex min-h-[56px] flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] text-navy/50"
        >
          <MoreHorizontal size={20} strokeWidth={1.75} />
          <span>עוד</span>
        </button>
      </div>

      {moreOpen && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label="סגירה"
            onClick={() => setMoreOpen(false)}
            className="absolute inset-0 bg-navy/30"
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-lineDark bg-white px-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-6 shadow-lg">
            <div className="mb-4 border-b border-lineDark pb-4">
              <p className="text-sm font-medium text-navy">{userName}</p>
              <p className="text-xs text-navy/50">{roleLabel}</p>
            </div>
            {overflow.length > 0 && (
              <nav className="mb-4 flex flex-col gap-4">
                {overflow.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    className="flex items-center gap-3 text-sm text-navy/80"
                  >
                    {(() => {
                      const Icon = ICONS[item.href] ?? Home;
                      return <Icon size={18} strokeWidth={1.75} />;
                    })()}
                    {item.label}
                  </Link>
                ))}
              </nav>
            )}
            <button
              onClick={() => signOut({ callbackUrl: "/app/login" })}
              className="flex w-full min-h-[44px] items-center justify-center gap-2 rounded-full border border-lineDark px-4 text-sm font-medium text-navy/70"
            >
              <LogOut size={16} strokeWidth={1.75} />
              התנתקות
            </button>
          </div>
        </div>
      )}
    </nav>
  );
}
