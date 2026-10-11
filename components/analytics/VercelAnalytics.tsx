"use client";

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";
import { sanitizePath } from "@/lib/attribution";

/**
 * Vercel Web Analytics, alongside GA4 (11.10.2026, claude/lead-attribution-gap-2026-10-11.md).
 *
 * Why a second tool: GA4 takes up to a day to process a day, and it is the only
 * place traffic is visible. Vercel's numbers appear within minutes, need no
 * cookie, and are kept in the same project as the deployment.
 *
 * What is sent is narrowed in beforeSend:
 *   - nothing from automated browsers, the same rule as the GA4 tag in the layout
 *     (about 97% of GA4 users in the 90 days to 1.10.2026 were headless Chrome);
 *   - nothing from the blog admin, which shares the marketing layout;
 *   - the URL keeps its path and campaign parameters only (lib/attribution.ts).
 */
function beforeSend(event: BeforeSendEvent): BeforeSendEvent | null {
  try {
    if (typeof navigator !== "undefined" && navigator.webdriver) return null;
    const u = new URL(event.url);
    if (/^\/(he|en)\/admin(\/|$)/.test(u.pathname)) return null;
    return { ...event, url: u.origin + sanitizePath(event.url) };
  } catch {
    return event;
  }
}

export function VercelAnalytics() {
  return <Analytics beforeSend={beforeSend} />;
}
