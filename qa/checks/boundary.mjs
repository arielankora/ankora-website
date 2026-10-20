// Level 3 - boundary and data integrity.
//
// The reserved slot, filled, and filled with the one rule this repo has
// already paid for twice.
//
// A query string is typed by people and pasted into chats. Every value in it
// is a string of unknown shape, and `Number()` answers NaN or Infinity
// rather than refusing. Neither throws where it is written. They throw
// somewhere else, as a 500 on a screen somebody was only looking at:
//
//   27.9.2026   three portal routes took `?monthOffset=` straight from the
//               URL. `?monthOffset=abc` reached Intl as an Invalid Date:
//               `RangeError: Invalid time value`, on a CLIENT-facing screen,
//               from a URL a client can type. Fixed with
//               lib/period-offset.ts.
//   18.10.2026  /app/audit-log took `?page=` the same way. `?page=1.001`
//               reaches Prisma as `skip: 0.025`, `?page=1e999` as
//               `skip: Infinity`, and Prisma rejects both. Found by the
//               weekly hunt, unfixed for two days, fixed with
//               lib/url-numbers.ts.
//
// Both were the same mistake in different words, and the second one happened
// after the first had been fixed, because the fix was a helper and nothing
// made anyone use it. A helper nobody is obliged to call is a suggestion.
//
// So this check is the obligation. In app/, a raw numeric coercion of
// something that came out of a URL is a blocker, and the finding names the
// parser to use.

import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { finding } from "../lib/report.mjs";

/** Parsers that are allowed to turn a URL value into a number. */
const APPROVED = ["parsePeriodOffset", "parsePageNumber"];

const ROOTS = ["app"];

/** Where a value arriving from the URL is named in this codebase. */
const FROM_URL = /\b(searchParams|params|query)\b/;

/** The coercions that answer NaN or Infinity instead of refusing. */
const COERCION = /\b(Number|parseInt|parseFloat)\s*\(/;

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      out.push(...(await walk(full)));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * The rule, as a pure function over one file's text.
 *
 * Line-based on purpose. A dataflow analysis that follows a value from the
 * query string to Prisma would catch more and would also be a second thing
 * to maintain; this catches the shape both real bugs had, which is the
 * coercion and the URL on the same line.
 *
 * @returns {{line: number, text: string}[]}
 */
export function rawUrlNumbers(source) {
  const hits = [];
  source.split("\n").forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
    if (!COERCION.test(code)) return;
    if (!FROM_URL.test(code)) return;
    if (APPROVED.some((fn) => code.includes(fn))) return;
    hits.push({ line: i + 1, text: line.trim() });
  });
  return hits;
}

export async function urlNumbers() {
  const files = [];
  for (const root of ROOTS) {
    try {
      files.push(...(await walk(root)));
    } catch {
      // A root that does not exist is not a finding about this rule.
    }
  }

  const strays = [];
  for (const file of new Set(files)) {
    const path = relative(".", file);
    // The parsers themselves coerce, which is the whole point of them.
    if (path.startsWith("lib/")) continue;
    let src;
    try {
      src = await readFile(path, "utf-8");
    } catch {
      continue;
    }
    for (const hit of rawUrlNumbers(src)) strays.push(`${path}:${hit.line}: ${hit.text}`);
  }

  if (strays.length === 0) return [];
  return [
    finding(
      "blocker",
      `${strays.length} raw numeric coercion(s) of a value from the URL`,
      [
        "`Number('abc')` is NaN and `Number('1e999')` is Infinity, and neither throws where it",
        "is written. They throw later, in Prisma or in Intl, as a 500 on a screen somebody was",
        "only looking at. This repo has shipped that bug twice: ?monthOffset= on three portal",
        "routes (27.9.2026) and ?page= on /app/audit-log (18.10.2026).",
        "",
        `Use one of: ${APPROVED.join(", ")} (lib/period-offset.ts, lib/url-numbers.ts).`,
        "",
        ...strays,
      ].join("\n"),
    ),
  ];
}
