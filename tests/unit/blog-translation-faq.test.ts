import { describe, it, expect } from "vitest";
import matter from "gray-matter";
import { cleanFaq, cleanTranslationOf, getBlogTranslationPairs, getPostBySlug, serializePost } from "@/lib/blog";

describe("cleanTranslationOf", () => {
  it("accepts a slug the routes would accept", () => {
    expect(cleanTranslationOf(" business-travel-planning ")).toBe("business-travel-planning");
  });
  it("refuses anything else", () => {
    expect(cleanTranslationOf("../../README")).toBeNull();
    expect(cleanTranslationOf("Business Travel")).toBeNull();
    expect(cleanTranslationOf("")).toBeNull();
    expect(cleanTranslationOf(42)).toBeNull();
  });
});

describe("cleanFaq", () => {
  it("keeps complete pairs and trims them", () => {
    expect(cleanFaq([{ q: " Why? ", a: " Because. " }])).toEqual([{ q: "Why?", a: "Because." }]);
  });
  it("drops half pairs and over-long answers instead of truncating them", () => {
    expect(cleanFaq([{ q: "Why?" }, { a: "Because." }, { q: "Long?", a: "x".repeat(1201) }])).toEqual([]);
  });
  it("caps the list at eight", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ q: `q${i}`, a: `a${i}` }));
    expect(cleanFaq(many)).toHaveLength(8);
  });
  it("is empty for anything that is not a list", () => {
    expect(cleanFaq(undefined)).toEqual([]);
    expect(cleanFaq("q: a")).toEqual([]);
  });
});

describe("serializePost", () => {
  const base = {
    title: "T",
    excerpt: "E",
    category: "company-insights" as const,
    tags: [],
    coverImage: null,
    coverImagePosition: "center" as const,
    author: "Ankora",
    publishedAt: "2026-10-11",
    updatedAt: null,
    draft: true,
  };

  it("writes translationOf and faq, so a save from the admin keeps them", () => {
    const out = matter(serializePost({ ...base, translationOf: "other", faq: [{ q: "Q", a: "A" }] }, "Body"));
    expect(out.data.translationOf).toBe("other");
    expect(out.data.faq).toEqual([{ q: "Q", a: "A" }]);
  });

  it("leaves both out when unset, so existing posts do not change shape", () => {
    const out = matter(serializePost(base, "Body"));
    expect("translationOf" in out.data).toBe(false);
    expect("faq" in out.data).toBe(false);
  });
});

describe("getBlogTranslationPairs (the real posts)", () => {
  const pairs = getBlogTranslationPairs();

  it("pairs the three published posts in both directions", () => {
    expect(pairs["he/esta"]).toBe("forgot-to-renew-your-esta-and-only-found-out-at-the-airport-here-s-what-to-do");
    expect(pairs["en/forgot-to-renew-your-esta-and-only-found-out-at-the-airport-here-s-what-to-do"]).toBe("esta");
    expect(pairs["he/business-travel-planning"]).toBe("business-travel-starts-long-before-you-board-the-plane");
    expect(pairs["he/recognized-expenses-self-employed-israel"]).toBe("tax-deductible-expenses-self-employed-israel");
    expect(pairs["en/tax-deductible-expenses-self-employed-israel"]).toBe("recognized-expenses-self-employed-israel");
  });

  it("only ever points at a post that exists and is published", () => {
    for (const [key, slug] of Object.entries(pairs)) {
      const other = key.startsWith("he/") ? "en" : "he";
      const post = getPostBySlug(other, slug);
      expect(post, `${key} -> ${slug}`).not.toBeNull();
      expect(post!.draft).toBe(false);
    }
  });
});
