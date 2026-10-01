"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics";

/**
 * One delegated listener instead of an onClick on every CTA: there are links
 * to /contact in the header, footer, hero and about a dozen sections, and a new
 * one should be counted without anyone remembering to wire it.
 *
 * cta_location is the area the click came from: "header", "footer", or the
 * heading of the section around the link, so GA4 can show which CTA works.
 */
function locationOf(el: Element): string {
  if (el.closest("header")) return "header";
  if (el.closest("footer")) return "footer";
  const section = el.closest("section");
  const heading = section?.querySelector("h1, h2");
  const text = ((heading as HTMLElement | null)?.innerText || heading?.textContent)?.replace(/\s+/g, " ").trim();
  if (text) return text.slice(0, 80);
  return "main";
}

export function CtaTracking() {
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target as Element | null;
      const link = target?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link) return;
      let path: string;
      try {
        path = new URL(link.href, window.location.href).pathname;
      } catch {
        return;
      }
      if (!/^\/(he|en)\/contact\/?$/.test(path)) return;
      if (window.location.pathname.replace(/\/$/, "") === path.replace(/\/$/, "")) return;
      track("cta_click", {
        cta_location: locationOf(link),
        cta_text: link.textContent?.replace(/\s+/g, " ").trim().slice(0, 80),
      });
    }
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, []);
  return null;
}
