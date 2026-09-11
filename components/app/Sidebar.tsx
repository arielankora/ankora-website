"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home } from "lucide-react";
import { NAV_ICONS } from "./nav-icons";
import { LogoutButton } from "./LogoutButton";

export type NavItem = { href: string; label: string; group?: string };

// Redesign direction A (approved by Ariel over direction B "editorial"):
// desktop gets a grouped, icon+label sidebar instead of the old single-row
// top nav (16+ flat text links, no grouping, wrapped awkwardly at some
// widths). Mobile is untouched - BottomNav.tsx already matched spec 11.1
// and the live audit found no real problem with it. Hidden below md via
// AppShell's wrapper; NAV_ICONS is the same map BottomNav uses so desktop
// and mobile never show different icons for the same screen.
export function Sidebar({
  items,
  userName,
  roleLabel,
}: {
  items: NavItem[];
  userName: string;
  roleLabel: string;
}) {
  const pathname = usePathname();

  function isActive(href: string) {
    return href === "/app" ? pathname === "/app" : pathname.startsWith(href);
  }

  let lastGroup: string | undefined;

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-e border-white/10 bg-navy md:flex">
      <div className="px-5 pb-2 pt-6">
        <Link href="/app" className="text-sm font-semibold uppercase tracking-[0.16em] text-goldLight">
          Ankora
        </Link>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="ניווט ראשי">
        {items.map((item) => {
          const showHeader = item.group && item.group !== lastGroup;
          lastGroup = item.group;
          const Icon = NAV_ICONS[item.href] ?? Home;
          const active = isActive(item.href);
          return (
            <div key={item.href}>
              {showHeader && (
                <p className="mb-1 mt-4 px-2 text-[11px] font-medium uppercase tracking-wide text-white/35 first:mt-1">
                  {item.group}
                </p>
              )}
              <Link
                href={item.href}
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors ${
                  active ? "bg-gold/15 font-medium text-goldLight" : "text-paper/85 hover:bg-white/5"
                }`}
              >
                <Icon size={16} strokeWidth={active ? 2.25 : 1.75} />
                <span className="truncate">{item.label}</span>
              </Link>
            </div>
          );
        })}
      </nav>
      <div className="border-t border-white/10 px-4 py-4">
        <p className="truncate text-sm font-medium text-paper">{userName}</p>
        <p className="mb-3 truncate text-xs text-paper/50">{roleLabel}</p>
        <LogoutButton variant="dark" />
      </div>
    </aside>
  );
}
