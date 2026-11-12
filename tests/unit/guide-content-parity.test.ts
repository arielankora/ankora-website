import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { GUIDE_GROUPS as HE } from "@/app/(product)/app/(authenticated)/guide/content";
import { GUIDE_GROUPS as EN } from "@/app/(product)/app/(authenticated)/guide/content.en";
import type { GuideGroup, GuideSection } from "@/app/(product)/app/(authenticated)/guide/content";

// The user guide exists twice: content.ts (Hebrew) and content.en.ts
// (English, ADR 0006). Other screens link to its anchors (#mcp-claude from
// the Claude connection card), and the role badges tell a reader what they
// can do, so the two must never drift apart: same groups, same sections in
// the same order, same roles, same screenshots, and the same number of
// paragraphs, steps and notes. A change to one guide is made in the other
// in the same pull request.
//
// Screenshots: the English guide may show the same picture taken in English,
// public/guide/en/<name>.png (scripts/guide-screenshots.mjs), in place of the
// Hebrew public/guide/<name>.png. It is still the same screenshot, so the
// shapes compare with the /en/ taken out, and every picture either guide
// names must exist.

/// "/guide/en/tasks.png" and "/guide/tasks.png" are the same screenshot.
const sameShot = (src: string) => src.replace(/^\/guide\/en\//, "/guide/");

function shape(groups: GuideGroup[]) {
  return groups.map((g) => ({
    id: g.id,
    sections: g.sections.map((s) => ({
      id: s.id,
      roles: s.roles,
      images: (s.images ?? []).map((i) => sameShot(i.src)),
      description: s.description.length,
      steps: s.steps?.length ?? 0,
      notes: s.notes?.length ?? 0,
    })),
  }));
}

function texts(groups: GuideGroup[]): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [];
  const add = (where: string, text: string) => out.push({ where, text });
  for (const g of groups) {
    add(`${g.id}.title`, g.title);
    for (const s of g.sections as GuideSection[]) {
      const at = `${g.id}/${s.id}`;
      add(`${at}.title`, s.title);
      add(`${at}.summary`, s.summary);
      s.description.forEach((t, i) => add(`${at}.description[${i}]`, t));
      (s.steps ?? []).forEach((t, i) => add(`${at}.steps[${i}]`, t));
      (s.notes ?? []).forEach((t, i) => add(`${at}.notes[${i}]`, t));
      (s.images ?? []).forEach((img, i) => {
        add(`${at}.images[${i}].alt`, img.alt);
        add(`${at}.images[${i}].caption`, img.caption);
      });
    }
  }
  return out;
}

describe("user guide, Hebrew and English", () => {
  it("have the same groups, sections, roles, screenshots and paragraph counts, in the same order", () => {
    expect(shape(EN)).toEqual(shape(HE));
  });

  it("name only screenshots that exist, the English ones under /guide/en/ or the Hebrew one", () => {
    const srcs = [...HE, ...EN].flatMap((g) => g.sections.flatMap((s) => (s.images ?? []).map((i) => i.src)));
    const missing = srcs.filter((src) => !/^\/guide\/(en\/)?[a-z0-9-]+\.png$/.test(src) || !fs.existsSync(path.join(process.cwd(), "public", src)));
    expect(missing).toEqual([]);
    const heInEn = HE.flatMap((g) => g.sections.flatMap((s) => (s.images ?? []).map((i) => i.src))).filter((src) => src.startsWith("/guide/en/"));
    expect(heInEn).toEqual([]);
  });

  it("keep the anchors other screens link to", () => {
    const ids = EN.flatMap((g) => g.sections.map((s) => s.id));
    expect(ids).toContain("mcp-claude");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("English guide has no Hebrew, and no empty text", () => {
    const bad = texts(EN).filter(({ text }) => /\p{Script=Hebrew}/u.test(text) || text.trim() === "");
    expect(bad).toEqual([]);
  });

  it("English guide has no long dashes", () => {
    const bad = texts(EN).filter(({ text }) => /[–—]/.test(text));
    expect(bad).toEqual([]);
  });
});
