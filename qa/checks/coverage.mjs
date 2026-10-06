// Level 3 - executed coverage, read against a floor.
//
// Why this exists, next to the capability scan.
//
// The scan (qa/lib/discover.mjs) asks "does any test *touch* this
// capability?", and it says so itself: a floor, not a ceiling. On
// 7.10.2026 it reported zero critical gaps while a real coverage run of the
// same suites showed that `getCurrentUser` (the gate in front of every
// screen), the cron bearer check, the whole MCP OAuth code store, the user
// role/suspend path, four internal reports and the client portal dashboard
// had never been executed by a single test. Every one of them was
// "touched": a server action imports lib/app-domain/users.ts, some test
// imports the same module for another function, and the action inherits
// the credit. The scan was right about what it measures, and what it
// measures was not the question.
//
// This check answers the question directly: run unit + integration with
// V8 coverage, and for every module where the rules live, compare the
// share of functions actually executed against qa/coverage-floor.json.
//
//  - A module that falls more than TOLERANCE points below its floor is a
//    major finding. Something stopped being exercised: a test was deleted,
//    skipped, or the module grew untested functions.
//  - A module that is not in the floor at all and executes zero functions
//    is a major finding. That is a new module nobody tested.
//  - A module that rose well above its floor is reported as minor, so the
//    floor gets raised. A ratchet that is never tightened is a blindfold.
//
// It never blocks. Coverage is a work list, not an outage, and percentages
// move a little between environments (the backup tests behave differently
// under a driver adapter, for one). The tolerance absorbs that; a real drop
// is bigger than that.
//
// Updating the floor after you add tests:
//
//     QA_COVERAGE_WRITE_FLOOR=1 node qa/run.mjs 3      (or run the check alone)
//
// and commit qa/coverage-floor.json with the PR that raised it.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { ROOT } from "../lib/discover.mjs";
import { sh, tail } from "../lib/sh.mjs";
import { finding } from "../lib/report.mjs";

const FLOOR_FILE = path.join(ROOT, "qa", "coverage-floor.json");
const OUT_DIR = path.join(ROOT, "qa", "reports", "coverage");
const TOLERANCE = 5; // percentage points of functions executed

// Where the rules live. Server actions and route handlers are thin shells
// over these (see needlesFor in qa/lib/discover.mjs); measuring the shells
// would mostly measure how many of them the browser suite happens to drive,
// which this check cannot see because e2e is not instrumented.
const MEASURED = ["lib/app-domain/", "lib/app-auth/", "lib/mcp/", "lib/vault/", "lib/cron-auth.ts"];

export function coverageProviderMissing() {
  try {
    createRequire(path.join(ROOT, "package.json")).resolve("@vitest/coverage-v8");
    return null;
  } catch {
    return "@vitest/coverage-v8 is not installed (add it to devDependencies)";
  }
}

function rel(file) {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

function measured(file) {
  return MEASURED.some((m) => file.startsWith(m));
}

/** Per-module function coverage, plus the names of the functions never run. */
function readCoverage() {
  const final = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "coverage-final.json"), "utf8"));
  const modules = {};
  for (const [abs, data] of Object.entries(final)) {
    const file = rel(abs);
    if (!measured(file)) continue;
    const ids = Object.keys(data.fnMap ?? {});
    const named = ids.filter((id) => !String(data.fnMap[id].name).startsWith("(anonymous"));
    const covered = ids.filter((id) => (data.f?.[id] ?? 0) > 0).length;
    const missed = named
      .filter((id) => (data.f?.[id] ?? 0) === 0)
      .map((id) => `${data.fnMap[id].name}:${data.fnMap[id].loc?.start?.line ?? "?"}`);
    modules[file] = {
      functions: ids.length,
      covered,
      pct: ids.length ? Math.round((covered / ids.length) * 1000) / 10 : 100,
      missed,
    };
  }
  return modules;
}

export async function coverage() {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  const include = MEASURED.map((m) => (m.endsWith("/") ? `--coverage.include=${m}**` : `--coverage.include=${m}`));
  const r = await sh(
    "npx",
    [
      "vitest",
      "run",
      "tests/unit",
      "tests/integration",
      "--coverage.enabled",
      "--coverage.provider=v8",
      "--coverage.reportOnFailure",
      "--coverage.reporter=json",
      `--coverage.reportsDirectory=${OUT_DIR}`,
      ...include,
      // Test failures are the unit and integration checks' business, and
      // they already ran. This run is only here for the numbers.
      "--reporter=dot",
    ],
    { timeoutMs: 25 * 60_000 },
  );
  if (!fs.existsSync(path.join(OUT_DIR, "coverage-final.json"))) {
    return [finding("major", "coverage run produced no report", tail(r.all, 25))];
  }

  const modules = readCoverage();
  const floor = fs.existsSync(FLOOR_FILE) ? JSON.parse(fs.readFileSync(FLOOR_FILE, "utf8")) : { modules: {} };
  const out = [];

  if (process.env.QA_COVERAGE_WRITE_FLOOR) {
    const next = {
      $comment: floor.$comment ?? [
        "Share of functions executed by unit + integration, per module. Written by qa/checks/coverage.mjs",
        "with QA_COVERAGE_WRITE_FLOOR=1. Raise it in the PR that adds tests; never lower it to pass.",
      ],
      updatedOn: new Date().toISOString().slice(0, 10),
      modules: Object.fromEntries(Object.entries(modules).sort().map(([f, m]) => [f, m.pct])),
    };
    fs.writeFileSync(FLOOR_FILE, JSON.stringify(next, null, 2) + "\n");
    out.push(finding("info", `coverage floor written for ${Object.keys(modules).length} modules`));
  }

  const dropped = [];
  const untestedNew = [];
  const raised = [];
  for (const [file, m] of Object.entries(modules)) {
    const was = floor.modules?.[file];
    if (was === undefined) {
      if (m.functions > 0 && m.covered === 0) untestedNew.push(`${file} (0/${m.functions}): ${m.missed.join(", ")}`);
      continue;
    }
    if (m.pct < was - TOLERANCE) dropped.push(`${file}: ${was}% → ${m.pct}%  never run: ${m.missed.slice(0, 8).join(", ")}`);
    else if (m.pct > was + 2 * TOLERANCE) raised.push(`${file}: ${was}% → ${m.pct}%`);
  }

  if (dropped.length)
    out.push(finding("major", `${dropped.length} module(s) fell below their coverage floor`, dropped.join("\n")));
  if (untestedNew.length)
    out.push(finding("major", `${untestedNew.length} new module(s) with no function ever executed by a test`, untestedNew.join("\n")));
  if (raised.length && !process.env.QA_COVERAGE_WRITE_FLOOR)
    out.push(finding("minor", `${raised.length} module(s) well above their floor: raise qa/coverage-floor.json`, raised.join("\n")));

  const totalFns = Object.values(modules).reduce((s, m) => s + m.functions, 0);
  const totalCov = Object.values(modules).reduce((s, m) => s + m.covered, 0);
  out.push(
    finding(
      "info",
      `${totalCov}/${totalFns} functions executed (${Math.round((totalCov / Math.max(totalFns, 1)) * 100)}%) across ${Object.keys(modules).length} modules`,
      Object.entries(modules)
        .filter(([, m]) => m.missed.length)
        .sort((a, b) => a[1].pct - b[1].pct)
        .slice(0, 15)
        .map(([f, m]) => `${m.pct}%  ${f}  never run: ${m.missed.slice(0, 6).join(", ")}`)
        .join("\n"),
    ),
  );
  return out;
}
