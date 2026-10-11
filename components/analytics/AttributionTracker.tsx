"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { recordPageView } from "@/lib/attribution-client";

/**
 * Records each page view of the marketing site so a contact request can say how
 * the person arrived and what they read first (lib/attribution.ts). Mounted once,
 * in app/[locale]/layout.tsx; the client area has its own layout and never runs it.
 *
 * Keyed on the pathname, so client-side navigations count as page views too.
 * The blog admin shares this layout and is not a visitor's page, so it is skipped.
 */
export function AttributionTracker() {
  const pathname = usePathname();
  useEffect(() => {
    if (/^\/(he|en)\/admin(\/|$)/.test(pathname ?? "")) return;
    recordPageView();
  }, [pathname]);
  return null;
}
