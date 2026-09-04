"use client";
import { useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";

export function MobileNav({
  items,
  userName,
  roleLabel,
}: {
  items: { href: string; label: string }[];
  userName: string;
  roleLabel: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-label={open ? "סגירת תפריט" : "פתיחת תפריט"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-9 items-center justify-center rounded-full border border-lineDark text-navy"
      >
        {open ? (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M1 1L15 15M15 1L1 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="18" height="12" viewBox="0 0 18 12" fill="none" aria-hidden="true">
            <path d="M0 1H18M0 6H18M0 11H18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        )}
      </button>

      {open && (
        <div className="fixed inset-x-0 top-[65px] z-40 border-b border-lineDark bg-white px-6 py-6 shadow-sm">
          <div className="mb-4 border-b border-lineDark pb-4">
            <p className="text-sm font-medium text-navy">{userName}</p>
            <p className="text-xs text-navy/50">{roleLabel}</p>
          </div>
          <nav className="flex flex-col gap-4">
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="text-sm text-navy/80"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <button
            onClick={() => signOut({ callbackUrl: "/app/login" })}
            className="mt-6 w-full rounded-full border border-lineDark px-4 py-2.5 text-sm font-medium text-navy/70"
          >
            התנתקות
          </button>
        </div>
      )}
    </div>
  );
}
