"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Locale } from "@/content";
import { cn } from "@/lib/utils";

export function LanguageToggle({ locale }: { locale: Locale }) {
  const pathname = usePathname();
  const rest = pathname.split("/").slice(2).join("/");

  const other: Locale = locale === "he" ? "en" : "he";
  const otherHref = `/${other}${rest ? `/${rest}` : ""}`;

  return (
    <Link
      href={otherHref}
      className={cn(
        "flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-paper/70",
        "transition-colors hover:border-lineGold hover:text-gold-light"
      )}
    >
      {other === "he" ? "עברית" : "EN"}
    </Link>
  );
}
