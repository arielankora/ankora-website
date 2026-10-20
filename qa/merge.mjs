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
import { SHARDS } from "./lib/shards.mjs";

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
  const broken = [];
  for (const file of findShardFiles(dir)) {
    try {
      const payload = JSON.parse(fs.readFileSync(file, "utf8"));
      const name = payload.shard ?? path.basename(file).replace(/^shard-|\.json$/g, "");
      // Two files for one shard means a re-run left an old artefact behind.
      // Keep the one that started later; say nothing, because this is normal.
      const prev = found.get(name);
      if (!prev || Date.parse(payload.summary?.startedAt ?? 0) > Date.parse(prev.summary?.startedAt ?? 0)) {
        found.set(name, payload);
      }
    } catch (err) {
      broken.push(`${file}: ${err?.message ?? err}`);
    }
  }
  return { found, broken };
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

function main() {
  const level = Number(arg("level", "3"));
  const dir = path.resolve(ROOT, arg("dir", path.join("qa", "reports")));
  const expected = (arg("expect") ?? SHARDS.join(",")).split(",").map((s) => s.trim()).filter(Boolean);

  const { found, broken } = readShards(dir);
  process.stdout.write(`\n  Merging level ${level} from ${dir}\n`);
  process.stdout.write(`  expected: ${expected.join(", ")}\n`);
  process.stdout.write(`  found:    ${[...found.keys()].join(", ") || "(none)"}\n\n`);

  // Shard order follows SHARDS, so the merged table reads the same way
  // every week rather than in whatever order the artefacts downloaded.
  const payloads = expected.filter((n) => found.has(n)).map((n) => found.get(n));
  const run = Run.fromShards(level, payloads);
  run.checks = [...run.checks, ...missingShardChecks(expected, found, broken)];

  run.print();
  const file = run.persist();
  process.stdout.write(`  Report: ${file}\n\n`);
  process.exit(run.failed ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
