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

async function runSuite(dir, env = {}, extraArgs = [], reportName = path.basename(dir)) {
  const outFile = path.join(ROOT, "qa", "reports", `vitest-${reportName}.json`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const r = await sh(
    "npx",
    ["vitest", "run", dir, ...extraArgs, "--reporter=json", `--outputFile=${outFile}`],
    { env, timeoutMs: 15 * 60_000 },
  );
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

/// The unit suite again, with the process in UTC - the zone Vercel runs
/// production in.
///
/// Added 28.9.2026 after a DST bug shipped in #127. qa.yml pins
/// TZ=Asia/Jerusalem for determinism, and in that zone the broken
/// date code happened to give the right answer: the test that described
/// the bug passed in CI, and main went red the moment anything ran it in
/// UTC. The weekly hunt of 27.9 found a second one of the same shape (the
/// home screen counting "today" from 03:00). A pin that makes CI agree
/// with a laptop in Tel Aviv also makes it disagree with the server,
/// and the server is the one that matters.
///
/// So both runs happen. The Israel one stays: it is how the people using
/// this read the dates, and a test that is only right in UTC is also
/// wrong. The UTC one is the server's view. A failure in only one of the
/// two is a date bug by definition, and it blocks like any other.
///
/// Same baseline, same rules. A known failure accepted for the Israel run
/// is not silently accepted here unless its waiver says `suite: "unit"`
/// and it fails the same way, which is the point.
export async function unitUtc() {
  const { r, parsed } = await runSuite("tests/unit", { TZ: "UTC" }, [], "unit-utc");
  return analyse(parsed, r, "unit (UTC)");
}

function integrationEnv() {
  return {
    DATABASE_URL:
      process.env.QA_DATABASE_URL ??
      process.env.DATABASE_URL ??
      "postgresql://ankora:ankora_dev_only@127.0.0.1:55432/ankora_dev",
  };
}

// --no-file-parallelism is not a performance choice, it is a
// correctness one.
//
// Every file under tests/integration shares ONE database and calls
// resetDb() - a TRUNCATE of every table - in its own beforeEach. Run
// two files at once and one of them truncates the rows the other is
// mid-way through using. The first CI run showed exactly that: 67
// failures, foreign-key violations on creates across a dozen unrelated
// tables, and assertions like "expected 90 to be 150" where rows had
// simply vanished underneath the test.
//
// It reads as 67 broken features. It is one broken assumption. The
// suite has raced itself since it was written; running the files in
// sequence is what makes any of its results mean anything.
export async function integration() {
  const { r, parsed } = await runSuite("tests/integration", integrationEnv(), ["--no-file-parallelism"]);
  return analyse(parsed, r, "integration");
}

/// The files whose code turns an instant into a day, a week, a month or a
/// billing cycle. Chosen 29.9.2026 by what each file exercises, not by
/// name: time entries, hour banks and their batch job, the client portal's
/// periods, adoption and alerts (both count "today"), notification
/// digests, reports, billing, important dates, the backup export and the
/// portal's third phase. A new date-heavy file belongs on this list; the
/// level-3 run covers everything regardless, so a file missing here is
/// caught weekly, not never.
export const DATE_SENSITIVE_INTEGRATION = [
  "time-entries",
  "hour-banks",
  "hour-banks-batch",
  "client-portal",
  "team-adoption",
  "alerts",
  "task-notifications",
  "reports",
  "billing",
  "important-dates",
  "backup-export",
  "portal-phase3",
].map((name) => `tests/integration/${name}.test.ts`);

/// The integration suite again, with the process in UTC, the zone Vercel
/// runs production in. Same reason as unitUtc above, one layer down: the
/// unit run proves the date helpers, this proves the queries that use
/// them return the right rows around midnight and across DST.
///
/// A full second run would add ~11 minutes to every PR gate, so level 2
/// runs the date-sensitive files and level 3 runs all of them. Files run
/// in sequence for the same reason as the Israel run: they share one
/// database and truncate it.
export async function integrationUtc(level) {
  const files = level >= 3 ? ["tests/integration"] : DATE_SENSITIVE_INTEGRATION;
  const missing = files.filter((f) => !fs.existsSync(path.join(ROOT, f)));
  if (missing.length) {
    // A renamed file would otherwise drop out of the UTC run in silence.
    return [finding("blocker", "UTC integration list names a file that does not exist", missing.join("\n"))];
  }
  const [first, ...rest] = files;
  const { r, parsed } = await runSuite(
    first,
    { ...integrationEnv(), TZ: "UTC" },
    [...rest, "--no-file-parallelism"],
    "integration-utc",
  );
  return analyse(parsed, r, "integration (UTC)");
}
