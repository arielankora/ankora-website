import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import config from "../../tailwind.config";

/**
 * The app palette by role (19.10.2026, claude/app-ui-conflicts-2026-10-19.md).
 *
 * Text on the app's light surfaces used to be built from appNavy at twelve
 * different opacities, and status colours came straight from Tailwind's own
 * red/emerald/amber. Both were replaced in one sweep. These checks keep them
 * out: a new screen copied from an old branch would otherwise bring them back
 * silently, since every one of those classes still compiles.
 */
function files(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files(full, acc);
    else if (/\.tsx?$/.test(entry)) acc.push(full);
  }
  return acc;
}

const APP = [
  ...files("app/(product)"),
  ...files("components/app"),
  // The blog admin is an internal screen on the same light palette.
  ...files("components/admin"),
  ...files("app/[locale]/admin"),
];

function offenders(pattern: RegExp): string[] {
  const out: string[] = [];
  for (const file of APP) {
    for (const m of readFileSync(file, "utf-8").matchAll(pattern)) out.push(`${file}: ${m[0]}`);
  }
  return out;
}

function tokenNames(colors: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(colors)) {
    const name = key === "DEFAULT" ? prefix.replace(/-$/, "") : `${prefix}${key}`;
    if (value && typeof value === "object") out.push(...tokenNames(value as Record<string, unknown>, `${name}-`));
    else out.push(name);
  }
  return out;
}

describe("app palette", () => {
  it("text is a role, never an opacity of appNavy", () => {
    expect(offenders(/\btext-appNavy(?:\/\d+)?\b/g)).toEqual([]);
  });

  it("status colours come from the app tokens, not Tailwind's palette", () => {
    expect(offenders(/\b(?:text|bg|border)-(?:red|emerald|green|amber)-\d{2,3}\b/g)).toEqual([]);
  });

  it("every app-* colour utility names a token that exists", () => {
    const known = new Set(tokenNames((config as any).theme.extend.colors));
    const used = offenders(/\b(?:bg|text|border|divide|ring|outline|decoration|accent|fill|stroke)-(app-[a-z-]+)(?:\/\d+)?\b/g)
      .map((line) => line.replace(/^.*?-(app-[a-z-]+)(?:\/\d+)?$/, "$1"))
      .filter((name) => !known.has(name));
    expect([...new Set(used)]).toEqual([]);
  });

  // 20.10.2026 (gap check after the UI round): gold is #B08D57, 3.1:1 on white
  // and 2.8:1 on the page ground, so as text it fails 4.5:1. Links and small
  // actions in gold use app-text-accent (#7A5F38). gold-light on the dark
  // sidebar is fine and is not matched.
  it("no gold text on the light surfaces", () => {
    expect(offenders(/(?<![\w-])(?:[a-z-]+:)*text-gold(?![\w-])/g)).toEqual([]);
  });

  it("the pre-role tokens are gone, in code and in the config", () => {
    expect(offenders(/(?<![\w-])(?:[a-z-]+:)*[a-z]+-(?:appNavy|lineDark)\b/g)).toEqual([]);
    const colors = (config as any).theme.extend.colors;
    for (const name of ["appNavy", "lineDark", "success", "warning", "neutral"]) expect(colors[name]).toBeUndefined();
    expect(Object.keys(colors.error)).toEqual(["on-dark"]);
  });
});
