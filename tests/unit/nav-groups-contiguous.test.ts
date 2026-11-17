import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// 17.11.2026: the sidebar draws a group's heading where the group's first
// item appears, and again wherever the group comes back after another
// one. A new "control" item pushed after the "settings" items drew "בקרה"
// twice, which the super admin's browser round caught. This reads the
// order the items are pushed in navItemsFor and holds that each group's
// items sit together.

const source = readFileSync(join(process.cwd(), "components/app/AppShell.tsx"), "utf8");
const body = source.slice(source.indexOf("function navItemsFor"), source.indexOf("function accountItems"));
const groups = [...body.matchAll(/item\("[^"]+",\s*"[^"]+",\s*"([a-z]+)"\)/g)].map((m) => m[1]);

describe("the sidebar's groups", () => {
  it("are read from the source at all", () => {
    expect(groups.length).toBeGreaterThan(10);
  });

  it("each keep their items together, so no heading is drawn twice", () => {
    const seen: string[] = [];
    const broken: string[] = [];
    for (const [i, g] of groups.entries()) {
      if (i > 0 && g !== groups[i - 1] && seen.includes(g)) broken.push(g);
      if (!seen.includes(g)) seen.push(g);
    }
    expect(broken).toEqual([]);
  });
});
