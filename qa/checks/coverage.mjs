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
//
// Split at level 3 (27.10.2026, see qa/lib/shards.mjs): three jobs each run a
// third of the test files under coverage and judge nothing, because a floor
// is about the whole suite and a third of it would report most modules as
// fallen. Each part leaves coverage-final.json in its artefact; qa/merge.mjs
// adds the parts up with mergeFinals() and judges the sum with judge().
// An unsplit run (level 3 locally, or any run without --shard) still does
// both here, in one go.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { ROOT } from "../lib/discover.mjs";
import { sh, tail, timedOutFinding } from "../lib/sh.mjs";
import { finding } from "../lib/report.mjs";

const FLOOR_FILE = path.join(ROOT, "qa", "coverage-floor.json");
const REPORTS = path.join(ROOT, "qa", "reports");
const TOLERANCE = 5; // percentage points of functions executed

// Where the rules live. Server actions and route handlers are thin shells
// over these (see needlesFor in qa/lib/discover.mjs); measuring the shells
// would mostly measure how many of them the browser suite happens to drive,
// which this check cannot see because e2e is not instrumented.
const MEASURED = ["lib/app-domain/", "lib/app-auth/", "lib/mcp/", "lib/vault/", "lib/cron-auth.ts"];

// The suites this check runs, which is also what the merge holds the parts
// against: every test file in these directories, in exactly one part.
export const SUITES = ["tests/unit", "tests/integration"];

/**
 * Where a part keeps its raw output, relative to qa/reports.
 *
 * Named after the split so three parts can sit side by side in one local
 * qa/reports, and so the merge can find a part's files next to its
 * shard-<name>.json however the artefact download nested them.
 */
export function partFiles(split) {
  const tag = split ? `-${split[0]}of${split[1]}` : "";
  return { dir: `coverage${tag}`, files: `vitest-coverage${tag}.json` };
}

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

const locKey = (loc) => `${loc?.start?.line}:${loc?.start?.column}-${loc?.end?.line}:${loc?.end?.column}`;

/**
 * Add up the coverage-final.json of several parts into one.
 *
 * By source location rather than by the numeric ids. Each part converts V8's
 * data for every measured file, loaded or not, so the maps should agree id
 * for id, but nothing promises that a file one part never imported is
 * numbered the same way as in a part that did. A location is the same
 * function in both; an id is only probably the same.
 */
export function mergeFinals(finals) {
  const out = {};
  for (const final of finals) {
    for (const [file, data] of Object.entries(final)) {
      if (!out[file]) {
        out[file] = structuredClone(data);
        continue;
      }
      const into = out[file];
      const add = (mapName, countName, keyOf, sum) => {
        const byKey = new Map(Object.entries(into[mapName]).map(([id, v]) => [keyOf(v), id]));
        let next = Object.keys(into[mapName]).length;
        for (const [id, v] of Object.entries(data[mapName] ?? {})) {
          const at = byKey.get(keyOf(v));
          if (at === undefined) {
            const fresh = String(next++);
            into[mapName][fresh] = v;
            into[countName][fresh] = structuredClone(data[countName][id]);
            byKey.set(keyOf(v), fresh);
          } else {
            into[countName][at] = sum(into[countName][at], data[countName][id]);
          }
        }
      };
      const plus = (a, b) => (a ?? 0) + (b ?? 0);
      add("statementMap", "s", locKey, plus);
      add("fnMap", "f", (fn) => `${fn.name}@${locKey(fn.decl ?? fn.loc)}`, plus);
      add("branchMap", "b", (br) => `${br.type}@${locKey(br.loc)}`, (a = [], b = []) =>
        Array.from({ length: Math.max(a.length, b.length) }, (_, i) => (a[i] ?? 0) + (b[i] ?? 0)),
      );
    }
  }
  return out;
}

/** Per-module function coverage, plus the names of the functions never run. */
export function modulesOf(final) {
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

/** The test files a part's vitest JSON report says it ran, relative to the repo. */
export function filesRun(report) {
  return (report?.testResults ?? []).map((t) => {
    const name = String(t.name).split(path.sep).join("/");
    const at = name.lastIndexOf("/tests/");
    return at >= 0 ? name.slice(at + 1) : rel(name);
  });
}

/** Every test file the suites hold, from the checkout itself. */
export function suiteFiles() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (/\.test\.tsx?$/.test(e.name)) out.push(p);
    }
  };
  for (const s of SUITES) if (fs.existsSync(path.join(ROOT, s))) walk(s);
  return out.sort();
}

/** Compare per-module coverage with the floor. The findings the check reports. */
export function judge(modules) {
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

/**
 * The check. `split` is `[k, n]` in a coverage shard, null otherwise.
 *
 * A part reports how many files it ran and nothing about the floor: that
 * verdict needs all the parts, and only qa/merge.mjs has them.
 */
export async function coverage(split = null) {
  const part = partFiles(split);
  const outDir = path.join(REPORTS, part.dir);
  const filesReport = path.join(REPORTS, part.files);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.rmSync(filesReport, { force: true });
  const include = MEASURED.map((m) => (m.endsWith("/") ? `--coverage.include=${m}**` : `--coverage.include=${m}`));
  const r = await sh(
    "npx",
    [
      "vitest",
      "run",
      ...SUITES,
      ...(split ? [`--shard=${split[0]}/${split[1]}`] : []),
      "--coverage.enabled",
      "--coverage.provider=v8",
      "--coverage.reportOnFailure",
      "--coverage.reporter=json",
      `--coverage.reportsDirectory=${outDir}`,
      ...include,
      // Test failures are the unit and integration checks' business, and
      // they already ran. This run is only here for the numbers.
      "--reporter=dot",
      // Which files ran, so the merge can prove the parts add up to the
      // suite: every file once, none twice, none missing.
      "--reporter=json",
      `--outputFile.json=${filesReport}`,
    ],
    // 40 minutes, from measurement: run #514 spent about 26 here, against a
    // budget of 25 that had never once been enforced (see lib/sh.mjs). The
    // number has to be one this run can actually meet, or the first honest
    // budget turns the weekly hunt red for being slow. Unchanged by the
    // split on purpose: a third of the suite measured about 14 minutes on
    // #602's numbers, so a part nearing 40 is a part to look at.
    { timeoutMs: 40 * 60_000 },
  );
  const stopped = timedOutFinding(r, "Coverage run");
  if (stopped) return [stopped];
  const finalFile = path.join(outDir, "coverage-final.json");
  if (!fs.existsSync(finalFile)) {
    return [finding("major", "coverage run produced no report", tail(r.all, 25))];
  }

  if (split) {
    let ran = [];
    try {
      ran = filesRun(JSON.parse(fs.readFileSync(filesReport, "utf8")));
    } catch {
      // Left to the merge, which checks the file list of every part and
      // says which one is missing.
    }
    // The same guard the integration shards carry (shardFileCount in
    // checks/vitest.mjs): a part that selected nothing is green and empty.
    if (ran.length === 0)
      return [finding("major", `coverage part ${split[0]}/${split[1]} ran no test files`, tail(r.all, 25))];
    return [
      finding(
        "info",
        `coverage part ${split[0]}/${split[1]}: ${ran.length} test file(s), judged against the floor in the merged report`,
      ),
    ];
  }

  return judge(modulesOf(JSON.parse(fs.readFileSync(finalFile, "utf8"))));
}
