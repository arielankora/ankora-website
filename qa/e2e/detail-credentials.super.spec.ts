import { test, expect } from "@playwright/test";
import {
  CREDENTIAL_PATTERNS,
  DYNAMIC_SWEEP,
  parentListRoute,
  routePattern,
  substituteKnownIds,
} from "./routes";

// The credential sweep, on the screens that render a record.
//
// screens.app.spec.ts and credentials.super.spec.ts run CREDENTIAL_PATTERNS
// over every product screen whose route has no dynamic segment - 41 of
// them - and over /app/users/[userId] by hand. Eleven screens have a
// dynamic segment, and the other ten have never been swept.
//
// That is the wrong ten to leave out. The fault this sweep exists for is
// a server component handing a database row to a client component, where
// Next serialises the whole row into the RSC payload inside the page
// HTML. A list screen maps rows to names before it renders them; a
// detail screen is built around one record. Of the three leaks in #84,
// two were on screens with an id in the route.
//
// No id is typed here. Each screen is reached from a page the product
// rendered: the list above it, the same id with this screen's own
// suffix, or a link harvested from a screen already opened.
//
// Super Admin rather than the employee session, for the reason the file
// next door gives: a leak needs data to leak, and for an employee most
// of these screens render a permission notice with nothing on it.
//
// @covers screen:/app/clients/[clientId]/client-file
// @covers screen:/app/clients/[clientId]/handover
// @covers screen:/app/clients/[clientId]/procedures
// @covers screen:/app/clients/[clientId]/processes/[processId]/document
// @covers screen:/app/tasks/[id]
//
// Declared for the same reason the detail-screens files declare: these
// screens really are opened, but by following the product's own links,
// so the bracketed path never appears as an address.

test.describe.configure({ timeout: 180_000 });

/** Every in-app address this page links to, as pathnames. */
async function harvest(page: import("@playwright/test").Page): Promise<string[]> {
  const hrefs = await page
    .locator('a[href^="/"]')
    .evaluateAll((els) => els.map((el) => (el as HTMLAnchorElement).getAttribute("href") ?? ""));
  return hrefs
    .map((h) => {
      try {
        return new URL(h, "http://x").pathname;
      } catch {
        return "";
      }
    })
    .filter(Boolean);
}

test("every detail screen ships no credential material", async ({ page }) => {
  // Addresses seen on every page opened so far, so a screen two levels
  // down is resolved from a link rather than from a hand-written id.
  const pool = new Set<string>();
  const resolved = new Map<string, string>();
  const missing: string[] = [];
  let swept = 0;

  for (const { route, optional } of DYNAMIC_SWEEP) {
    await test.step(route, async () => {
      const wanted = substituteKnownIds(route, resolved);
      const matcher = routePattern(wanted);

      let target = wanted.includes("/[") ? [...pool].find((p) => matcher.test(p)) : wanted;
      if (!target) {
        // The list screen above the first segment still unknown.
        const list = substituteKnownIds(parentListRoute(route), resolved);
        if (!list.includes("/[")) {
          const response = await page.goto(list, { waitUntil: "domcontentloaded" });
          if (response?.status() === 200) for (const p of await harvest(page)) pool.add(p);
        }
        target = [...pool].find((p) => matcher.test(p));
      }

      if (!target) {
        missing.push(optional ? `${route} (not swept: ${optional})` : route);
        return;
      }

      const response = await page.goto(target, { waitUntil: "domcontentloaded" });
      expect.soft(response?.status(), `${target} HTTP status`).toBe(200);
      if (response?.status() !== 200) return;

      const html = await page.content();
      for (const { pattern, what } of CREDENTIAL_PATTERNS) {
        expect.soft(html, `${target} served ${what}`).not.toMatch(pattern);
      }

      swept += 1;
      resolved.set(route, target);
      for (const p of await harvest(page)) pool.add(p);
    });
  }

  // A sweep that resolved nothing passes every assertion it never made.
  // #510 is the precedent: three of four shards reported success with a
  // "Run QA" of zero seconds.
  expect(swept, "no detail screen was reached at all - the sweep checked nothing").toBeGreaterThan(0);

  const required = missing.filter((m) => !m.includes("(not swept:"));
  expect(
    required,
    [
      "These screens are in DYNAMIC_SWEEP and no instance of them could be found.",
      "Either the list above them stopped linking to them, or the screen moved.",
      "A screen that resolves to nothing is a check that quietly stopped running;",
      "if it is genuinely data-dependent, give it an `optional` reason in routes.ts.",
    ].join("\n"),
  ).toEqual([]);

  // Said out loud rather than skipped in silence: a reader of the report
  // can see which screens this run did not actually cover.
  for (const m of missing) console.warn(`[detail-sweep] ${m}`);
});
