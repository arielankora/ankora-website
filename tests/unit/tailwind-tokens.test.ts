import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import config from "../../tailwind.config";

/**
 * A Tailwind class naming a token that does not exist emits no CSS. Nothing throws,
 * nothing warns, the build is green and the element simply renders with no colour.
 *
 * That is not hypothetical: the C5 role rename removed `paper`, and a branch opened
 * before the rename and merged after it left `bg-paper` and `text-paper` on the OAuth
 * consent screen. `text-paper` on a `bg-navy` button meant the approve button's label
 * inherited its colour -- dark text on a dark fill, on the screen where somebody grants
 * an integration access to their data.
 *
 * A merge race is the normal way this happens, so the guard has to live in the suite
 * rather than in whoever remembers.
 */
const UTILITIES =
  "bg|text|border|outline|ring|divide|fill|stroke|from|via|to|decoration|accent|caret|placeholder|shadow";

function tokenNames(colors: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(colors)) {
    const name = key === "DEFAULT" ? prefix.replace(/-$/, "") : `${prefix}${key}`;
    if (value && typeof value === "object") out.push(...tokenNames(value as Record<string, unknown>, `${name}-`));
    else out.push(name);
  }
  return out;
}

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.tsx?$/.test(entry)) acc.push(full);
  }
  return acc;
}

describe("tailwind colour tokens", () => {
  it("every colour utility in the source names a token that exists", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const colors = (config as any).theme?.extend?.colors ?? {};
    const known = new Set(tokenNames(colors));
    // Tailwind's own palette and keywords, which the config extends rather than replaces.
    const builtIn = /^(inherit|current|transparent|black|white|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(-|$)/;
    const pattern = new RegExp(`\\b(?:${UTILITIES})-([a-zA-Z][a-zA-Z0-9]*(?:-[a-zA-Z0-9]+)*)(?:/\\d+)?\\b`, "g");

    const unknown: string[] = [];
    for (const file of [...sourceFiles("app"), ...sourceFiles("components"), ...sourceFiles("lib")]) {
      const src = readFileSync(file, "utf-8");
      for (const match of src.matchAll(pattern)) {
        const token = match[1];
        if (builtIn.test(token) || known.has(token)) continue;
        // Not every `prefix-word` is a colour utility: bg-cover, text-sm, border-2 and
        // so on. Only flag a name that looks like a colour token we once had.
        if (/^(paper|ink|tone|navyLight|paperDim)(-|$)/.test(token)) {
          unknown.push(`${file}: ${match[0]}`);
        }
      }
    }

    expect(unknown).toEqual([]);
  });
});
