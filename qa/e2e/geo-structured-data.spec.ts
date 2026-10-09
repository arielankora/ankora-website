import { test, expect, type Page } from "@playwright/test";
import { getDictionary } from "@/content";

// Structured data that answer engines read, checked against what a visitor sees.
//
// Added 9.10.2026 with the pricing numbers and the visible FAQs on pricing,
// how-it-works and technology. The point of a FAQPage block is that it says
// exactly what the page says. A question in the JSON-LD that is not on the
// page is the kind of mismatch that gets structured data ignored, and it is
// silent in a build log. So every question in every FAQPage on these pages
// must be a visible, clickable question, and every answer must be in the
// rendered HTML.

const FAQ_PAGES = [
  "pricing",
  "how-it-works",
  "technology",
  "ankora-vs-personal-assistant",
  "personal-assistant-for-executives",
];

async function jsonLd(page: Page): Promise<Record<string, unknown>[]> {
  const raw = await page
    .locator('script[type="application/ld+json"]')
    .evaluateAll((nodes) => nodes.map((n) => n.textContent ?? ""));
  // Parsing is itself an assertion: a block that does not parse is invisible
  // to a crawler.
  return raw.flatMap((r) => {
    const parsed = JSON.parse(r);
    return Array.isArray(parsed) ? parsed : [parsed];
  });
}

type FaqNode = { mainEntity: { name: string; acceptedAnswer: { text: string } }[] };

for (const locale of ["he", "en"] as const) {
  for (const slug of FAQ_PAGES) {
    const route = `/${locale}/${slug}`;

    test(`${route}: every FAQPage question is visible on the page`, async ({ page }) => {
      await page.goto(route);
      const faqs = (await jsonLd(page)).filter((n) => n["@type"] === "FAQPage") as unknown as FaqNode[];
      expect(faqs.length, `${route} publishes a FAQPage`).toBeGreaterThan(0);

      const bodyText = (await page.locator("main").textContent()) ?? "";
      for (const faq of faqs) {
        expect(faq.mainEntity.length, `${route} FAQPage has questions`).toBeGreaterThan(0);
        for (const item of faq.mainEntity) {
          await expect(
            page.locator("button[aria-expanded]", { hasText: item.name }).first(),
            `${route} shows the question "${item.name}"`,
          ).toBeVisible();
          expect(bodyText, `${route} renders the answer to "${item.name}"`).toContain(item.acceptedAnswer.text);
        }
      }
    });
  }

  for (const slug of ["pricing", "how-it-works", "technology"]) {
    const route = `/${locale}/${slug}`;
    test(`${route}: the FAQ opens and closes`, async ({ page }) => {
      await page.goto(route);
      const key = slug === "pricing" ? "pricing" : slug === "how-it-works" ? "howItWorks" : "technology";
      const first = getDictionary(locale).pages[key].faq.items[0];
      const button = page.locator("button[aria-expanded]", { hasText: first.q }).first();
      await button.scrollIntoViewIfNeeded();
      await expect(button).toHaveAttribute("aria-expanded", "false");
      await button.click();
      await expect(button).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByText(first.a).first()).toBeVisible();
      await button.click();
      await expect(button).toHaveAttribute("aria-expanded", "false");
    });
  }

  test(`/${locale}/pricing: the Offer schema matches the packages on the page`, async ({ page }) => {
    await page.goto(`/${locale}/pricing`);
    const tiers = getDictionary(locale).pages.pricing.tiers.items;
    const service = (await jsonLd(page)).find(
      (n) => n["@type"] === "Service" && "hasOfferCatalog" in n,
    ) as
      | {
          hasOfferCatalog: {
            itemListElement: {
              name: string;
              price: number;
              priceCurrency: string;
              priceSpecification: { price: number; unitCode: string; valueAddedTaxIncluded: boolean };
            }[];
          };
        }
      | undefined;
    expect(service, "pricing publishes a Service with an offer catalog").toBeTruthy();

    const offers = service!.hasOfferCatalog.itemListElement;
    expect(offers.map((o) => o.name)).toEqual(tiers.map((t) => t.name));
    for (const [i, tier] of tiers.entries()) {
      expect(offers[i].price, `${tier.name} monthly price`).toBe(tier.hoursPerMonth * tier.hourlyRate);
      expect(offers[i].priceCurrency).toBe("ILS");
      expect(offers[i].priceSpecification.price, `${tier.name} hourly rate`).toBe(tier.hourlyRate);
      expect(offers[i].priceSpecification.unitCode).toBe("HUR");
      expect(offers[i].priceSpecification.valueAddedTaxIncluded).toBe(false);
      // The schema's hourly rate is the one printed on the card.
      await expect(page.getByText(tier.rate, { exact: true }).first()).toBeVisible();
    }
  });

  test(`/${locale}/roi: the calculator prices Ankora at the highlighted package rate`, async ({ page }) => {
    // 9.10.2026: the calculator quoted ₪130 while the pricing page highlighted
    // ₪160. A visitor who used both saw two different prices for one service.
    const dict = getDictionary(locale);
    const highlighted = dict.pages.pricing.tiers.items.find((t) => t.highlighted)!;
    const persona = dict.pages.roi.personas[0];
    const weekly = Object.values(persona.hours).reduce((a, b) => a + b, 0);
    const expected = Math.round(weekly * (52 / 12) * highlighted.hourlyRate);

    await page.goto(`/${locale}/roi`);
    const cost = page.locator("dt", { hasText: dict.pages.roi.results.costLabel }).locator("xpath=following-sibling::dd[1]");
    await expect(cost).toBeVisible();
    const digits = ((await cost.textContent()) ?? "").replace(/\D/g, "");
    expect(Number(digits), "Ankora cost on the default persona").toBe(expected);
  });

  test(`/${locale}/ankora-vs-personal-assistant: the comparison table fits a phone`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/${locale}/ankora-vs-personal-assistant`);
    const p = getDictionary(locale).pages.ankoraVsPersonalAssistant;
    await expect(page.getByText(p.tableSource).first()).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "no horizontal page scroll at 390px").toBeLessThanOrEqual(1);
  });
}
