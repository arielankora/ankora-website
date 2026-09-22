// Level 1 - static analysis. Cheap, deterministic, catches the class of
// breakage that never reaches a browser because the build dies first.

import { sh, tail } from "../lib/sh.mjs";
import { finding } from "../lib/report.mjs";

export async function types() {
  const r = await sh("npx", ["tsc", "--noEmit"], { timeoutMs: 6 * 60_000 });
  if (r.code === 0) return [];
  const errors = r.all.split("\n").filter((l) => /error TS\d+/.test(l));
  return [
    finding("blocker", `${errors.length} TypeScript error(s)`, errors.slice(0, 15).join("\n")),
  ];
}

export async function lint() {
  const r = await sh("npx", ["next", "lint", "--max-warnings", "9999"], { timeoutMs: 6 * 60_000 });
  const warnings = (r.all.match(/Warning:/g) ?? []).length;
  const errors = (r.all.match(/Error:/g) ?? []).length;
  const out = [];
  // The repo carries two baseline warnings (documented in the redesign
  // notes). Anything above that is new and worth a look, but lint noise
  // is never a reason to block a deploy.
  if (errors) out.push(finding("major", `${errors} lint error(s)`, tail(r.all, 20)));
  if (warnings > 2) out.push(finding("minor", `${warnings} lint warnings (baseline is 2)`, tail(r.all, 20)));
  return out;
}

// ── Production-only branches ──────────────────────────────────────────
//
// 22.9.2026. A new employee's invite email carried an address she could
// not open. The branch that chose it ran only in production, and no test
// has ever run in production. Seven more branches of the same shape were
// sitting in the codebase unexamined, three of them deciding whether a
// raw token or an insecure cookie goes out.
//
// The shape is what matters, not the instance. Any `process.env.NODE_ENV`
// or `process.env.VERCEL_ENV` comparison is a fork whose production side
// no test environment can reach, so all of them now live in lib/env.ts,
// where tests/unit/production-branches.test.ts stands on both sides of
// each one. This check is what keeps the ninth from being written
// somewhere else and never being looked at again.
//
// Blocking on purpose. It is a two-line fix - call the helper - and the
// alternative is the failure mode that produced the incident: something
// true only in production, believed correct because it was never run.

import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const ENV_HOME = "lib/env.ts";
const BRANCH = /process\.env\.(NODE_ENV|VERCEL_ENV)/g;
const ROOTS = ["lib", "app"];
const FILES = ["middleware.ts", "auth.ts", "auth.config.ts"];

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

export async function productionBranches() {
  const files = [...FILES];
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
    if (path === ENV_HOME) continue;
    let src;
    try {
      src = await readFile(path, "utf-8");
    } catch {
      continue;
    }
    for (const line of src.split("\n")) {
      // A comment naming the variable is documentation, not a branch.
      const code = line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
      const hits = code.match(BRANCH);
      if (hits) strays.push(`${path}: ${line.trim()}`);
    }
  }

  if (strays.length === 0) return [];
  return [
    finding(
      "blocker",
      `${strays.length} production-only branch(es) outside ${ENV_HOME}`,
      [
        "Each of these behaves differently in production, and no test environment is production.",
        `Route it through ${ENV_HOME} (isProductionBuild / isProductionDeployment / devOnly) so`,
        "tests/unit/production-branches.test.ts covers both sides of it.",
        "",
        ...strays,
      ].join("\n"),
    ),
  ];
}
