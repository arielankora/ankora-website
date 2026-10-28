#!/usr/bin/env node
// Merge the shard reports of a split level-3 run into one verdict.
//
//   node qa/merge.mjs --level=3 --dir=qa/reports [--expect=main,integration,utc,coverage]
//
// Why a merge step exists at all: when level 3 runs as parallel jobs, no
// single job knows whether the run passed. Each one writes
// qa/reports/shard-<name>.json and nothing else - deliberately, so that a
// quarter of a run can never publish "PASS" into last.md, which is what
// the pull-request comment and the triage agent read.
//
// The rule that matters here is the one this suite learned the hard way in
// September: a check that did not run is not a check that passed. A shard
// whose report never arrived - a runner that died, an artifact that did
// not upload, a job skipped because an earlier one failed - is reported as
// a blocker by name, not quietly left out of the table. A green report
// covering three quarters of a run is worse than a red one.

import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./lib/discover.mjs";
import { Run, finding } from "./lib/report.mjs";
import { ALWAYS, checksOwnedBy, shardsFor, splitFor } from "./lib/shards.mjs";
import { filesRun, judge, mergeFinals, modulesOf, partFiles, suiteFiles } from "./checks/coverage.mjs";

function arg(name, fallback = null) {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

/** Every shard-*.json under `dir`, however deeply the artifact download nested it. */
function findShardFiles(dir) {
  const out = [];
  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (/^shard-.+\.json$/.test(e.name)) out.push(full);
    }
  };
  walk(dir);
  return out;
}

export function readShards(dir) {
  const found = new Map();
  // name -> the file the winning report came from. A coverage part keeps its
  // raw data next to its report, so this is where the merge looks for it.
  const files = new Map();
  const broken = [];
  for (const file of findShardFiles(dir)) {
    try {
      const payload = JSON.parse(fs.readFileSync(file, "utf8"));
      const name = payload.shard ?? path.basename(file).replace(/^shard-|\.json$/g, "");
      // A report with no rows in it is not a report.
      //
      // Run #510 found out how one gets here: a unit test constructed a
      // Run for the `utc` shard and called persist(), which wrote a real
      // shard-utc.json into qa/reports - inside the `main` job, whose
      // artefact then carried it. The merge downloaded two files claiming
      // to be the utc shard, and which one won came down to whose
      // timestamp was later. The test is fixed; this is so that the next
      // stray file cannot shadow a real shard either.
      if (!Array.isArray(payload.checks) || payload.checks.length === 0) continue;
      // Two files for one shard means a re-run left an old artefact behind.
      // Keep the one that started later; say nothing, because this is normal.
      const prev = found.get(name);
      if (!prev || Date.parse(payload.summary?.startedAt ?? 0) > Date.parse(prev.summary?.startedAt ?? 0)) {
        found.set(name, payload);
        files.set(name, file);
      }
    } catch (err) {
      broken.push(`${file}: ${err?.message ?? err}`);
    }
  }
  return { found, files, broken };
}

/**
 * The missing-shard rows, as checks so they carry the verdict.
 *
 * Blocking on purpose: `Run.failed` is what turns the job red, and a shard
 * that never reported is exactly the silent-green case this guards.
 */
export function missingShardChecks(expected, found, broken) {
  const rows = [];
  for (const name of expected) {
    if (found.has(name)) continue;
    rows.push({
      id: `shard-${name}`,
      label: `Shard: ${name}`,
      status: "fail",
      blocking: true,
      ms: 0,
      findings: [
        finding(
          "blocker",
          `the "${name}" shard produced no report`,
          [
            "Its job did not finish, or its artefact did not upload.",
            "The checks that shard owns (see qa/lib/shards.mjs) did not run, so this run has no opinion about them.",
            "Open the job for that shard in this workflow run.",
          ].join("\n"),
        ),
      ],
    });
  }
  // A shard that reported, but without the checks it exists to run.
  //
  // Stronger than counting shards: a shard can arrive complete-looking and
  // still be missing the one pass it owns, which is how a quarter of the
  // hunt disappears while every job shows a tick.
  for (const [name, payload] of found) {
    const owned = checksOwnedBy(name);
    const present = new Set((payload.checks ?? []).map((c) => c.id));
    const absent = owned.filter((id) => !present.has(id));
    if (absent.length === 0) continue;
    rows.push({
      id: `shard-${name}-incomplete`,
      label: `Shard: ${name}`,
      status: "fail",
      blocking: true,
      ms: 0,
      findings: [
        finding(
          "blocker",
          `the "${name}" shard reported without ${absent.join(", ")}`,
          [
            `qa/lib/shards.mjs says this shard runs: ${owned.join(", ")}.`,
            `Its report does not contain: ${absent.join(", ")}.`,
            "Either the runner did not get that far, or another file claiming to be this shard was merged in its place.",
          ].join("\n"),
        ),
      ],
    });
  }

  for (const why of broken) {
    rows.push({
      id: "shard-unreadable",
      label: "Shard report unreadable",
      status: "fail",
      blocking: true,
      ms: 0,
      findings: [finding("blocker", "a shard report could not be parsed", why)],
    });
  }
  return rows;
}

/** A row's status from its findings, the way Run.check decides it. */
function statusOf(findings) {
  if (findings.some((f) => f.severity === "blocker")) return "fail";
  return findings.length ? "warn" : "pass";
}

/**
 * The coverage verdict, out of the parts. Empty when coverage is not split.
 *
 * Each part ran a third of the files and judged nothing (see
 * checks/coverage.mjs). Here the three coverage-final.json files are added
 * up and the sum is held against the floor once, which is the only way the
 * floor means what it says.
 *
 * Two things are checked before any number is believed:
 *
 *  - every part is here. A missing part already blocks the run by name (see
 *    missingShardChecks); this row says the floor was not judged, rather
 *    than judging two thirds of the suite and reporting most of the code as
 *    untested.
 *  - the parts ran every test file once. vitest's `--shard` promises that,
 *    and this holds it to the promise against the files in the checkout: a
 *    file in no part is coverage nobody measured, a file in two is a split
 *    that is not one.
 *
 * Never blocking, like the check itself: coverage is a work list.
 */
export function coverageRows(expected, found, files, outDir = path.join(ROOT, "qa", "reports", partFiles(null).dir)) {
  const parts = expected.filter((n) => splitFor(n) && checksOwnedBy(n).includes("coverage"));
  if (parts.length === 0) return [];
  const started = Date.now();
  const row = (findings) => ({
    id: "coverage-merged",
    label: `Executed coverage (floor, ${parts.length} parts merged)`,
    status: statusOf(findings),
    blocking: false,
    ms: Date.now() - started,
    findings,
  });

  // A part whose files are there but unreadable is still a coverage
  // problem, not a reason to lose the whole verdict: a throw here would stop
  // the merge before it printed anything.
  try {
    return judgeParts(parts, files, outDir, row);
  } catch (err) {
    return [row([finding("major", "the coverage parts could not be merged", String(err?.stack ?? err))])];
  }
}

function judgeParts(parts, files, outDir, row) {
  const finals = [];
  const ranBy = new Map(); // test file -> the parts that ran it
  const absent = [];
  for (const name of parts) {
    const at = files.get(name);
    const { dir, files: listFile } = partFiles(splitFor(name));
    const finalFile = at && path.join(path.dirname(at), dir, "coverage-final.json");
    const list = at && path.join(path.dirname(at), listFile);
    if (!at || !fs.existsSync(finalFile) || !fs.existsSync(list)) {
      absent.push(name);
      continue;
    }
    finals.push(JSON.parse(fs.readFileSync(finalFile, "utf8")));
    for (const f of filesRun(JSON.parse(fs.readFileSync(list, "utf8")))) {
      if (!ranBy.has(f)) ranBy.set(f, []);
      ranBy.get(f).push(name);
    }
  }
  if (absent.length) {
    return [
      row([
        finding(
          "major",
          `coverage was not judged: no data from ${absent.join(", ")}`,
          [
            "The floor is about the whole suite, and the parts that did report hold only some of it.",
            "Judging them alone would report most modules as having fallen. Open the job for the part named above.",
          ].join("\n"),
        ),
      ]),
    ];
  }

  const out = [];
  const suite = suiteFiles();
  const missing = suite.filter((f) => !ranBy.has(f));
  const twice = [...ranBy].filter(([, by]) => by.length > 1).map(([f, by]) => `${f} (${by.join(", ")})`);
  if (missing.length || twice.length)
    out.push(
      finding(
        "major",
        `the coverage parts do not add up to the suite: ${missing.length} file(s) in no part, ${twice.length} in more than one`,
        [...missing.map((f) => `in no part: ${f}`), ...twice.map((f) => `more than once: ${f}`)].join("\n"),
      ),
    );
  else out.push(finding("info", `${suite.length} test files, each in exactly one of ${parts.length} parts`));

  // Kept in the merged artefact, so the summed numbers can be read again
  // without re-running anything.
  const merged = mergeFinals(finals);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "coverage-final.json"), JSON.stringify(merged));
  out.push(...judge(modulesOf(merged)));
  return [row(out)];
}

/**
 * One row per check.
 *
 * The checks in ALWAYS (preflight) run in every shard by design, so the
 * merged table would otherwise carry four of them and count each one in
 * the summary. Keep the worst: a preflight that found no browser in one
 * shard is the interesting one, not the three that did.
 */
const RANK = { fail: 4, skipped: 3, warn: 2, pass: 1 };

const worseOf = (a, b) => {
  if (!a) return b;
  const ra = RANK[a.status] ?? 0;
  const rb = RANK[b.status] ?? 0;
  if (rb !== ra) return rb > ra ? b : a;
  return b.findings.length > a.findings.length ? b : a;
};

export function dedupe(checks) {
  const out = [];
  const seen = new Map(); // id -> index in `out`, for ALWAYS ids only
  for (const c of checks) {
    if (!ALWAYS.includes(c.id)) {
      out.push(c);
      continue;
    }
    const at = seen.get(c.id);
    if (at === undefined) {
      seen.set(c.id, out.push(c) - 1);
    } else {
      out[at] = worseOf(out[at], c);
    }
  }
  return out;
}

function main() {
  const level = Number(arg("level", "3"));
  const dir = path.resolve(ROOT, arg("dir", path.join("qa", "reports")));
  const expected = (arg("expect") ?? (shardsFor(level) ?? []).join(",")).split(",").map((s) => s.trim()).filter(Boolean);

  const { found, files, broken } = readShards(dir);
  process.stdout.write(`\n  Merging level ${level} from ${dir}\n`);
  process.stdout.write(`  expected: ${expected.join(", ")}\n`);
  process.stdout.write(`  found:    ${[...found.keys()].join(", ") || "(none)"}\n\n`);

  // Shard order follows SHARDS, so the merged table reads the same way
  // every week rather than in whatever order the artefacts downloaded.
  const payloads = expected.filter((n) => found.has(n)).map((n) => found.get(n));
  const run = Run.fromShards(level, payloads);
  run.checks = dedupe([...run.checks, ...coverageRows(expected, found, files), ...missingShardChecks(expected, found, broken)]);

  run.print();
  const file = run.persist();
  process.stdout.write(`  Report: ${file}\n\n`);

  // INCOMPLETE exits non-zero here, and this is the one place it does.
  //
  // qa/run.mjs has always exited 0 on an incomplete run: the verdict said
  // so in words and the exit code disagreed, which is how run #508 put
  // three green ticks on a hunt that had tested nothing. Changing that
  // globally would turn the pull-request gate red whenever the production
  // probe cannot reach the site, so the rule is applied where the blast
  // radius is the weekly run and the reader is looking for exactly this.
  if (run.incomplete) {
    const skipped = run.checks.filter((c) => c.blocking && c.status === "skipped");
    process.stderr.write(
      [
        "  INCOMPLETE: a blocking check did not run.",
        ...skipped.map((c) => `    ${c.id}: ${c.reason ?? "no reason given"}`),
        "",
        "  A skipped check is not a passed check.",
        "",
      ].join("\n"),
    );
  }
  process.exit(run.shouldFail ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
