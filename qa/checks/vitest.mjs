// Level 1 (unit) / level 2 (integration) - the existing suites, but read
// against a baseline.
//
// The baseline is the point of this file. A suite with three long-standing
// red tests trains everyone to skim past red, and the fourth failure - the
// real one - goes unnoticed. `qa/baseline.json` names each accepted failure
// with a reason and the date it was accepted, so a known-red test reports
// as `info` with its age, and *any* failure that is not on that list is a
// blocker. Red means red again.

import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../lib/discover.mjs";
import { sh, tail } from "../lib/sh.mjs";
import { finding } from "../lib/report.mjs";

const BASELINE = path.join(ROOT, "qa", "baseline.json");

function baseline() {
  if (!fs.existsSync(BASELINE)) return { knownFailures: [] };
  return JSON.parse(fs.readFileSync(BASELINE, "utf8"));
}

function daysSince(iso) {
  return Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

async function runSuite(dir, env = {}) {
  const outFile = path.join(ROOT, "qa", "reports", `vitest-${path.basename(dir)}.json`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const r = await sh("npx", ["vitest", "run", dir, "--reporter=json", `--outputFile=${outFile}`], {
    env,
    timeoutMs: 15 * 60_000,
  });
  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(outFile, "utf8"));
  } catch {
    /* fall through to raw-output handling below */
  }
  return { r, parsed };
}

function analyse(parsed, r, suiteName) {
  const known = baseline().knownFailures ?? [];
  if (!parsed) {
    return r.code === 0
      ? []
      : [finding("blocker", `${suiteName} suite failed and produced no parseable report`, tail(r.all, 25))];
  }

  const failures = [];
  for (const file of parsed.testResults ?? []) {
    for (const t of file.assertionResults ?? []) {
      if (t.status !== "failed") continue;
      failures.push({
        name: t.fullName ?? t.title,
        file: path.relative(ROOT, file.name ?? ""),
        message: (t.failureMessages ?? []).join("\n").split("\n").slice(0, 6).join("\n"),
      });
    }
  }

  const out = [];
  const matched = new Set();
  for (const f of failures) {
    // Match on the test NAME, with the file as an extra constraint - never
    // as an alternative. An earlier version used `||` here, which made every
    // failure in a file match the file's FIRST waiver: the other two were
    // then reported as stale on every run, and "stale waiver" is exactly the
    // signal you want to be able to trust when pruning the baseline.
    const entry = known.find(
      (k) => f.name.includes(k.test) && (!k.file || f.file.endsWith(k.file)),
    );
    if (entry) {
      matched.add(entry.test);
      out.push(
        finding("info", `known failure (${daysSince(entry.acceptedOn)}d): ${f.name}`, entry.reason, {
          accepted: entry.acceptedOn,
        }),
      );
    } else {
      out.push(finding("blocker", `NEW failing test: ${f.name}`, `${f.file}\n${f.message}`));
    }
  }

  // A waiver that stopped matching means the test was fixed or renamed -
  // stale waivers are how a baseline quietly becomes a blindfold.
  for (const k of known.filter((k) => k.suite === suiteName && !matched.has(k.test))) {
    out.push(
      finding("minor", `stale waiver: "${k.test}" no longer fails`, `Remove it from qa/baseline.json (accepted ${k.acceptedOn}).`),
    );
  }

  const total = (parsed.numTotalTests ?? 0);
  out.push(finding("info", `${suiteName}: ${total - failures.length}/${total} passing`));
  return out;
}

export async function unit() {
  const { r, parsed } = await runSuite("tests/unit");
  return analyse(parsed, r, "unit");
}

export async function integration() {
  const env = {
    DATABASE_URL:
      process.env.QA_DATABASE_URL ??
      process.env.DATABASE_URL ??
      "postgresql://ankora:ankora_dev_only@127.0.0.1:55432/ankora_dev",
  };
  const { r, parsed } = await runSuite("tests/integration", env);
  return analyse(parsed, r, "integration");
}
