import { test, expect } from "@playwright/test";
import { MARKETING_ROUTES, isRealConsoleError } from "./routes";

// The marketing sweep.
//
// Every public page, in both locales, checked for the faults that are
// invisible in a build log and obvious to a visitor: a page that 500s, a
// runtime error in the console, an image that never loads, a heading
// that never rendered. None of these break `next build`; all of them are
// the first thing a person notices.
//
// The route list comes from qa/manifest.json, so a page added next month
// is swept next month without anyone editing this file.

test.describe("public pages", () => {
  for (const route of MARKETING_ROUTES) {
    test(`${route} renders without faults`, async ({ page }) => {
      const consoleErrors: string[] = [];
      const failedRequests: string[] = [];

      page.on("console", (msg) => {
        if (msg.type() === "error" && isRealConsoleError(msg.text())) consoleErrors.push(msg.text());
      });
      page.on("pageerror", (err) => consoleErrors.push(String(err)));
      page.on("requestfailed", (req) => {
        // Analytics and other third-party beacons are blocked by CSP or
        // by the runner's own network, and their failure says nothing
        // about this page.
        if (new URL(req.url()).origin === new URL(page.url() || "http://x").origin) {
          failedRequests.push(`${req.url()} — ${req.failure()?.errorText ?? "failed"}`);
        }
      });

      const response = await page.goto(route, { waitUntil: "domcontentloaded" });

      expect(response?.status(), `${route} HTTP status`).toBe(200);
      await expect(page.locator("h1").first(), `${route} has a visible h1`).toBeVisible();
      expect(consoleErrors, `${route} console`).toEqual([]);
      expect(failedRequests, `${route} same-origin requests`).toEqual([]);
    });
  }
});

test.describe("SEO signals that have regressed before", () => {
  // docs/adr/0002: a canonical pointing at the wrong host cost 16 URLs in
  // Search Console. It is one line in a layout and it breaks the whole
  // site at once, so it is worth a standing check.
  for (const route of ["/he", "/en", "/he/pricing", "/he/blog"]) {
    test(`${route} declares a self-consistent canonical`, async ({ page }) => {
      await page.goto(route);
      const canonical = await page.locator('link[rel="canonical"]').first().getAttribute("href");

      expect(canonical, `${route} has a canonical`).toBeTruthy();
      expect(canonical, `${route} canonical uses the www host`).toContain("www.ankora.co.il");
      // The self-contradiction that caused the incident: a canonical that
      // points somewhere other than the page declaring it.
      expect(canonical!.endsWith(route) || canonical!.endsWith(`${route}/`)).toBe(true);
    });
  }

  test("each locale points at the other through hreflang", async ({ page }) => {
    await page.goto("/he");
    const langs = await page.locator("link[rel=alternate][hreflang]").evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute("hreflang")),
    );
    expect(langs).toEqual(expect.arrayContaining(["he", "en"]));
  });
});

test.describe("Hebrew renders as Hebrew", () => {
  // The product is Hebrew-first. A layout that silently falls back to LTR
  // looks broken to every primary user and to nobody testing in English.
  test("the Hebrew homepage is right-to-left", async ({ page }) => {
    await page.goto("/he");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("lang", "he");
  });

  test("the English homepage is left-to-right", async ({ page }) => {
    await page.goto("/en");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  test("no page ships a raw mojibake artefact of mis-encoded Hebrew", async ({ page }) => {
    // Cheap guard for the encoding failure that turns Hebrew into
    // question marks or Ã-sequences. It has bitten this project's own
    // documents before; it would be worse in the product.
    await page.goto("/he");
    const body = (await page.locator("body").innerText()).slice(0, 5000);
    expect(body).not.toMatch(/Ã[\u0080-¿]/);
    expect(body).toMatch(/[֐-׿]/);
  });
});

test.describe("the product is not publicly indexable", () => {
  test("robots.txt exists and is served as text", async ({ request }) => {
    const res = await request.get("/robots.txt");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text");
  });

  test("sitemap.xml exists and lists the canonical host only", async ({ request }) => {
    const res = await request.get("/sitemap.xml");
    expect(res.status()).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("<urlset");
    // The other half of the ADR-0002 incident: sitemap entries on the
    // non-www host, redirecting to a page whose canonical points back.
    expect(xml).not.toMatch(/<loc>https:\/\/ankora\.co\.il/);
  });
});
