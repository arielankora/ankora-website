import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import he from "../../messages/he.json";
import en from "../../messages/en.json";

/**
 * ADR 0006. The two dictionaries must say the same things: the same keys,
 * nothing left empty, and the same placeholders, so a value the code
 * passes is never silently dropped in one language. Every message must
 * also format, with the arguments the code gives it, without an error:
 * a broken plural is a crash on a person's screen, not a typo.
 */

type Tree = { [key: string]: string | Tree };

function leaves(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(path, value);
    else for (const [k, v] of leaves(value, path)) out.set(k, v);
  }
  return out;
}

/// The names a message substitutes: `{name}` or `{name, plural, ...}`.
/// The words inside a plural branch ("{# days ago}") are not names.
function argumentNames(message: string): string[] {
  return [...new Set([...message.matchAll(/\{\s*([A-Za-z_]\w*)\s*[,}]/g)].map((m) => m[1]))].sort();
}

const heLeaves = leaves(he as Tree);
const enLeaves = leaves(en as Tree);

describe("app dictionaries (ADR 0006)", () => {
  it("have exactly the same keys", () => {
    const missingInEn = [...heLeaves.keys()].filter((k) => !enLeaves.has(k));
    const missingInHe = [...enLeaves.keys()].filter((k) => !heLeaves.has(k));
    expect({ missingInEn, missingInHe }).toEqual({ missingInEn: [], missingInHe: [] });
  });

  it("leave nothing empty", () => {
    const empty = [...heLeaves, ...enLeaves].filter(([, v]) => !v.trim()).map(([k]) => k);
    expect(empty).toEqual([]);
  });

  it("use the same tags in both languages", () => {
    const tagsOf = (v: string) => [...v.matchAll(/<(\w+)>/g)].map((m) => m[1]).sort().join(",");
    const mismatched = [...heLeaves].filter(([key, value]) => tagsOf(value) !== tagsOf(enLeaves.get(key) ?? "")).map(([key]) => key);
    expect(mismatched).toEqual([]);
  });

  it("use the same placeholders in both languages", () => {
    const mismatched = [...heLeaves]
      .filter(([key, value]) => JSON.stringify(argumentNames(value)) !== JSON.stringify(argumentNames(enLeaves.get(key) ?? "")))
      .map(([key]) => key);
    expect(mismatched).toEqual([]);
  });

  it("format every message in both languages", () => {
    const failures: string[] = [];
    for (const [locale, messages, flat] of [
      ["he", he, heLeaves],
      ["en", en, enLeaves],
    ] as const) {
      const t = createTranslator({
        locale,
        messages,
        timeZone: "Asia/Jerusalem",
        onError: (error) => failures.push(`${locale}: ${error.message}`),
      });
      for (const [key, value] of flat) {
        const args = Object.fromEntries(argumentNames(value).map((name) => [name, name === "count" || name === "hours" || name === "min" ? 3 : "x"]));
        // A message with tags (<name></name>) is rendered through t.rich,
        // the way the screens render it, with each tag given a handler.
        const tags = [...value.matchAll(/<(\w+)>/g)].map((m) => m[1]);
        const out = tags.length
          ? JSON.stringify((t as any).rich(key, { ...args, ...Object.fromEntries(tags.map((tag) => [tag, () => `[${tag}]`])) }))
          : ((t as any)(key, args) as string);
        if (out.includes("{")) failures.push(`${locale}: ${key} left a placeholder: ${out}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("contain no long dashes", () => {
    // House style: a comma, a colon or a new sentence instead.
    const dashed = [...heLeaves, ...enLeaves].filter(([, v]) => /[\u2013\u2014]/.test(v)).map(([k]) => k);
    expect(dashed).toEqual([]);
  });

  it("keep Hebrew out of the English dictionary", () => {
    const hebrew = [...enLeaves].filter(([, v]) => /[֐-׿]/.test(v)).map(([k]) => k);
    expect(hebrew).toEqual([]);
  });
});
