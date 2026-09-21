import { test, expect } from "@playwright/test";
import { MARKETING_ROUTES, CUSTOMER_STORY_ROUTES, isRealConsoleError } from "./routes";

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

test.describe("customer stories", () => {
  // @covers page:/[locale]/customer-stories/[slug]
  //
  // Declared rather than inferred, and this is the case the escape hatch was
  // written for. The tests below really do load every published story page, but
  // they get the URLs from CUSTOMER_STORY_ROUTES, which builds them from the
  // content at run time - so the literal `[slug]` path the scanner looks for
  // appears nowhere, and cannot, without typing out an inventory that goes
  // stale the day story #2 publishes. The alternative was a hand-written list,
  // which is the thing routes.ts exists to avoid.

  // The hub itself is already swept above - it is a marketing page and the
  // manifest found it. Story pages are not: the sweep excludes dynamic routes
  // because /customer-stories/[slug] needs a real slug. These are the checks
  // that are specific to this section rather than true of every page.

  for (const route of CUSTOMER_STORY_ROUTES) {
    test(`${route} renders and is indexable`, async ({ page }) => {
      const response = await page.goto(route, { waitUntil: "domcontentloaded" });
      expect(response?.status(), `${route} HTTP status`).toBe(200);
      await expect(page.locator("h1").first()).toBeVisible();

      // evaluateAll, not getAttribute: a public page has no robots meta at all,
      // and a locator that resolves to nothing makes getAttribute WAIT for it -
      // which is a 30-second test timeout reported as "the page did not render",
      // for a page that rendered fine. The absence is the pass here, so the
      // check has to be able to see an empty list.
      const robots = await page
        .locator('meta[name="robots"]')
        .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("content") ?? "").join(" "));
      expect(robots, `${route} must not be noindex`).not.toContain("noindex");
    });
  }

  for (const route of ["/he/customer-stories", "/en/customer-stories", ...CUSTOMER_STORY_ROUTES]) {
    test(`${route} declares a self-referencing canonical and both hreflangs`, async ({ page }) => {
      await page.goto(route);

      const canonical = await page.locator('link[rel="canonical"]').first().getAttribute("href");
      expect(canonical, `${route} has a canonical`).toBeTruthy();
      expect(canonical, `${route} canonical uses the www host`).toContain("www.ankora.co.il");
      expect(canonical!.endsWith(route) || canonical!.endsWith(`${route}/`), `${route} canonical is self-referencing`).toBe(true);

      const langs = await page
        .locator("link[rel=alternate][hreflang]")
        .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("hreflang")));
      expect(langs, `${route} hreflang pair`).toEqual(expect.arrayContaining(["he", "en"]));
    });
  }

  for (const route of ["/he/customer-stories", "/en/customer-stories", ...CUSTOMER_STORY_ROUTES]) {
    test(`${route} emits parseable structured data with no rating claim`, async ({ page }) => {
      await page.goto(route);

      const blocks = await page
        .locator('script[type="application/ld+json"]')
        .evaluateAll((nodes) => nodes.map((n) => n.textContent ?? ""));
      expect(blocks.length, `${route} has JSON-LD`).toBeGreaterThan(0);

      const types = blocks.flatMap((raw) => {
        // Parsing is itself the assertion: a JSON-LD block that does not parse
        // is invisible to a crawler and silent in a build log.
        const parsed = JSON.parse(raw);
        return (Array.isArray(parsed) ? parsed : [parsed]).map((o) => o["@type"]);
      });

      // Never a rating or a review corpus - Ankora has neither, and claiming
      // one in markup is the kind of thing that earns a manual action.
      //
      // Checked against the parsed @type values and key names, not against the
      // raw text: a substring search would also fire on a customer whose title
      // happens to contain the word, which would be a false accusation of the
      // one thing this test exists to police.
      const claims = blocks.flatMap((raw) => {
        const found: string[] = [];
        JSON.parse(raw, function (key, value) {
          if (["ratingValue", "reviewCount", "ratingCount", "aggregateRating", "review"].includes(key)) {
            found.push(`key ${key}`);
          }
          if (key === "@type" && ["Review", "AggregateRating", "Rating"].includes(value)) {
            found.push(`@type ${value}`);
          }
          return value;
        });
        return found;
      });
      expect(claims, `${route} must claim no rating or review`).toEqual([]);
      expect(types, `${route} emits a BreadcrumbList`).toContain("BreadcrumbList");
    });
  }

  // A page no plain <a> reaches is a page a crawler does not reach either, and
  // the brief names four entry points rather than one. Checked as real anchors
  // in the rendered DOM, not as strings in the source, because a link behind a
  // click handler satisfies neither a crawler nor a keyboard.
  const ENTRY_POINTS = [
    { from: "/he", where: "footer" },
    { from: "/he/personal-operations-management", where: "body" },
    { from: "/he/solutions/executives", where: "body" },
  ];

  for (const { from, where } of ENTRY_POINTS) {
    test(`${from} links to the hub - no orphan`, async ({ page }) => {
      await page.goto(from);
      const link = page.locator(`${where} a[href="/he/customer-stories"]`);
      await expect(link.first(), `${from} has no link to the hub`).toBeAttached();
    });
  }

  test("the footer link is present on a story page too, so the section is navigable from inside it", async ({ page }) => {
    const route = CUSTOMER_STORY_ROUTES.find((r) => r.startsWith("/he/"));
    test.skip(!route, "no published Hebrew story");
    await page.goto(route!);
    await expect(page.locator('footer a[href="/he/customer-stories"]').first()).toBeAttached();
  });

  test("the sitemap lists the hub and every published story, in both locales", async ({ page }) => {
    const xml = await (await page.request.get("/sitemap.xml")).text();
    for (const route of ["/he/customer-stories", "/en/customer-stories", ...CUSTOMER_STORY_ROUTES]) {
      const loc = `<loc>https://www.ankora.co.il${route}</loc>`;
      expect(xml.split(loc).length - 1, `${route} appears exactly once in the sitemap`).toBe(1);
    }
    // A Hebrew-slugged URL would be percent-encoded into an unreadable <loc>
    // and would not match the page the router actually serves.
    expect(xml, "sitemap contains a non-ASCII slug").not.toMatch(/<loc>[^<]*[\u0590-\u05FF][^<]*<\/loc>/);
  });

  test("Hebrew on a story page is neither letter-spaced nor forced left-to-right", async ({ page }) => {
    const route = CUSTOMER_STORY_ROUTES.find((r) => r.startsWith("/he/"));
    test.skip(!route, "no published Hebrew story");
    await page.goto(route!);

    const faults = await page.evaluate(() => {
      const hebrew = /[\u0590-\u05FF]/;
      const out: string[] = [];
      for (const el of Array.from(document.querySelectorAll("body *"))) {
        const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && hebrew.test(n.textContent ?? ""));
        if (!own) continue;
        const cs = getComputedStyle(el);
        const text = (el.textContent ?? "").trim().slice(0, 40);
        // Positive tracking on Hebrew: the letters come apart. MonoLabel's
        // rtl:tracking-normal is what is meant to prevent this.
        if (parseFloat(cs.letterSpacing) > 0.01) out.push(`letter-spaced: ${text}`);
        // A Hebrew run inside a forced LTR box comes out with its words mirrored.
        if (el.closest('[dir="ltr"]')) out.push(`forced ltr: ${text}`);
      }
      return out;
    });

    expect(faults, "Hebrew typography faults").toEqual([]);
  });
});
