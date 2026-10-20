// Is the scheduled run still doing its job?
//
// Every other check in this suite looks at the product. This one looks at
// the suite, and specifically at the one thing none of the others can
// see: a nightly or weekly run that did not finish.
//
// Why it exists, and it is not hypothetical. The Sunday level-3 hunt was
// stopped by the job's 45-minute wall on 11.10.2026 and again on
// 18.10.2026. Both runs produced no verdict and nobody noticed for two
// weeks. Three things hid it at once:
//
//   1. A run stopped by the job wall is labelled "cancelled", not
//      "failed". "Cancelled" reads as a person having stopped it.
//   2. qa/run.mjs is killed before it prints a verdict, so the uploaded
//      report has no PASS/FAIL line to be alarmed by.
//   3. The weekday level-2 runs were all green, and a list of green runs
//      with one grey one in it looks fine at a glance.
//
// So the signal worth having is not "did the last run pass" - it is "has
// anything scheduled failed to produce an answer, and is the suite
// heading for the wall". Both are below.
//
// On reading the API, and why this needed a workflow change after all.
//
// The repository is public, so the Actions API answers unauthenticated -
// the first version of this check relied on that, to avoid touching
// .github at all. It was wrong, and the sandbox said so within a minute:
//
//   403 {"message":"API rate limit exceeded for 34.58.4.212..."}
//
// Unauthenticated calls get 60 an hour PER IP, and both the sandbox and
// GitHub's runners sit behind shared addresses. A watchdog that quietly
// stops watching whenever a neighbour has been busy is the exact failure
// it was written to catch, so it reads the API as the workflow's own
// GITHUB_TOKEN (1000/hour per repository) when one is in the environment,
// and falls back to unauthenticated only outside CI.
//
// That needs two things in qa.yml, and they ship with this check:
// `actions: read` in the job's permissions, and GITHUB_TOKEN in the step's
// env. Without the first, GitHub answers "Resource not accessible by
// integration"; the finding below names that so the cause is not a guess.

import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../lib/discover.mjs";
import { finding } from "../lib/report.mjs";
import { fetchOnce, unreachableBecause } from "../lib/sh.mjs";

const API = "https://api.github.com";
const WORKFLOW = "qa.yml";

// How many scheduled runs to look at. Three weeks of nightlies, so there
// are always at least two Sundays in the window even if a day is missed.
const WINDOW = 25;

// A daily cron that has not fired in this long has stopped firing.
//
// Generous on purpose. GitHub defers scheduled workflows under load: the
// 25 runs before this check was written were all written as "0 3 * * *"
// and all actually started between 07:21 and 10:01 UTC. A tighter bound
// would cry wolf on an ordinary busy morning; 36 hours cannot be reached
// by deferral alone.
const SILENT_HOURS = 36;

// Report headroom once a run uses this much of the wall. The point is to
// say "this is coming" while there is still room to act, rather than
// after a run has already been cut off.
const HEADROOM_RATIO = 0.8;

/**
 * The job's wall, read from the workflow rather than copied here.
 *
 * A number duplicated in two files is a number that will disagree with
 * itself. The job-level key sits at four spaces; the step-level budget on
 * "Run QA" sits at eight, so the indent is what tells them apart.
 */
export function jobWallMinutes(yaml, job = "qa") {
  const text = yaml ?? readWorkflow();
  if (!text) return null;
  // 20.10.2026: the workflow has more than one job now (level selection,
  // the sharded checks, the merge), so "the first four-space
  // timeout-minutes in the file" would return whichever job happens to be
  // written first. The checks job is the one with a wall worth watching.
  const scope = jobBlock(text, job) ?? text;
  const m = scope.match(/^ {4}timeout-minutes:\s*(\d+)\s*$/m);
  return m ? Number(m[1]) : null;
}

/** The body of one job, by name, down to the next key at the same indent. */
function jobBlock(text, job) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l === `  ${job}:`);
  if (start === -1) return null;
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {2}\S/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join("\n");
}

function readWorkflow() {
  const file = path.join(ROOT, ".github", "workflows", WORKFLOW);
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/**
 * owner/repo, from the Actions environment or from the git remote.
 *
 * @param {Record<string, string | undefined>} [env] - defaults to the real
 *   environment. Annotated rather than inferred from the default, so a test
 *   can hand it a plain object instead of a ProcessEnv.
 * @returns {string | null}
 */
export function repoSlug(env = process.env) {
  if (env.GITHUB_REPOSITORY) return env.GITHUB_REPOSITORY;
  try {
    const config = fs.readFileSync(path.join(ROOT, ".git", "config"), "utf8");
    const m = config.match(/url\s*=\s*\S*github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\s*$/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

const hours = (ms) => ms / 3_600_000;
const minutes = (ms) => ms / 60_000;
const when = (d) => d.toISOString().replace("T", " ").slice(0, 16) + " UTC";

/** Finished runs only, newest first, with a duration attached. */
function finished(runs) {
  return runs
    .filter((r) => r.status === "completed" && r.run_started_at && r.updated_at)
    .map((r) => ({
      number: r.run_number,
      conclusion: r.conclusion,
      started: new Date(r.run_started_at),
      ended: new Date(r.updated_at),
      sha: (r.head_sha ?? "").slice(0, 7),
      url: r.html_url,
      get ms() {
        return this.ended - this.started;
      },
      // The level is chosen inside the job by `date -u +%u`, so Sunday in
      // UTC at the moment the run STARTED is what picked level 3. Not the
      // cron's nominal day: a run deferred past midnight would have been
      // given the level of the day it actually ran on, which is the same
      // thing this reads.
      get sunday() {
        return this.started.getUTCDay() === 0;
      },
    }))
    .sort((a, b) => b.started - a.started);
}

/**
 * The whole judgement, as a pure function over the API's rows.
 *
 * Separated from the fetch on purpose. A watchdog whose logic can only be
 * exercised by having a real run fail is a watchdog nobody can test, and
 * this suite has been bitten by environment-dependent tests before.
 */
export function assess(runs, { wallMinutes, now = new Date() } = {}) {
  const out = [];
  const all = finished(runs);

  if (all.length === 0) {
    out.push(finding("minor", "no finished scheduled run to look at", "nothing to compare against yet"));
    return out;
  }

  const newest = all[0];

  // 1. Has the schedule stopped firing at all?
  const quiet = hours(now - newest.started);
  if (quiet > SILENT_HOURS) {
    out.push(
      finding(
        "major",
        `no scheduled run in ${Math.floor(quiet)} hours`,
        `The newest is #${newest.number}, started ${when(newest.started)}. The cron is daily, and GitHub's deferral tops out at a few hours, so a gap this size means the schedule is not firing. Check that the workflow is enabled: GitHub disables schedules on repositories with no activity for 60 days.`,
      ),
    );
  }

  // 2. The newest finished run did not produce a pass.
  //
  // "cancelled" is called out by name because it is the one that does not
  // look like a failure, and it is what the 45-minute wall produces.
  if (newest.conclusion !== "success") {
    out.push(
      finding(
        "major",
        `the last scheduled run ${newest.conclusion}`,
        [
          `#${newest.number} (${newest.sha}) started ${when(newest.started)} and ran ${minutes(newest.ms).toFixed(1)} min.`,
          newest.conclusion === "cancelled"
            ? "A run stopped by the job's timeout is reported as cancelled, which reads as a person having stopped it. Check the run's annotations for \"exceeded the maximum execution time\" before assuming someone did."
            : "",
          newest.url,
        ]
          .filter(Boolean)
          .join("\n"),
      ),
    );
  }

  // 3. The Sunday run, separately.
  //
  // This is the one that went missing. Sunday is the deep hunt, it is the
  // only run that reaches the level-3 checks, and six green weekday runs
  // sitting on top of it in the list are exactly what made a grey Sunday
  // invisible for two weeks running.
  const sunday = all.find((r) => r.sunday);
  if (sunday && sunday.conclusion !== "success" && sunday.number !== newest.number) {
    out.push(
      finding(
        "major",
        `the last weekly fault hunt ${sunday.conclusion}`,
        [
          `Sunday's run is the only one that reaches the level-3 checks.`,
          `#${sunday.number} (${sunday.sha}) started ${when(sunday.started)} and ran ${minutes(sunday.ms).toFixed(1)} min.`,
          `Weekday runs since then have been green, which is why this is reported on its own: a green list with one grey row in it looks fine.`,
          sunday.url,
        ].join("\n"),
      ),
    );
  }

  // 4. Headroom against the wall.
  //
  // The preventive one. Every number here was available two weeks before
  // the hunt first got cut off; nothing was reading them.
  if (wallMinutes) {
    const limit = wallMinutes * HEADROOM_RATIO;
    const tight = all.filter((r) => minutes(r.ms) >= limit).sort((a, b) => b.ms - a.ms);
    if (tight.length) {
      const worst = tight[0];
      out.push(
        finding(
          "minor",
          `a scheduled run used ${Math.round((minutes(worst.ms) / wallMinutes) * 100)}% of the ${wallMinutes}-minute wall`,
          [
            `#${worst.number}, ${minutes(worst.ms).toFixed(1)} min, ${when(worst.started)}.`,
            tight.length > 1 ? `${tight.length} of the last ${all.length} scheduled runs were this close.` : "",
            "The suite grows; the wall does not. This is the warning that there is still room to act in.",
          ]
            .filter(Boolean)
            .join("\n"),
        ),
      );
    }
  }

  const bad = all.filter((r) => r.conclusion !== "success").length;
  const longest = all.reduce((a, b) => (a.ms >= b.ms ? a : b));
  out.push(
    finding(
      "info",
      `${all.length} scheduled runs, ${bad} not successful, longest ${minutes(longest.ms).toFixed(1)} min`,
      wallMinutes ? `job wall is ${wallMinutes} min` : "job wall could not be read from the workflow",
    ),
  );
  return out;
}

export const skipIfUnreachable = async () => {
  if (!repoSlug()) return "cannot tell which repository this is (no GITHUB_REPOSITORY and no github.com remote)";
  const why = await unreachableBecause(`${API}/rate_limit`);
  if (why) return `${API} not reachable from here (${why}) — this check belongs in CI`;
  return null;
};

/**
 * Say WHY the API refused, when it did.
 *
 * The two 403s mean opposite things and want opposite fixes, and telling
 * them apart is the difference between an actionable line and "something
 * went wrong". Both are quoted from real responses.
 */
export function refusalReason(status, body, authenticated) {
  const message = String(body?.message ?? "");
  if (status === 403 && /rate limit/i.test(message)) {
    return authenticated
      ? "the repository's hourly API budget is spent"
      : "unauthenticated calls are capped at 60 an hour per IP, and this one had no token. In CI, check that GITHUB_TOKEN reaches the Run QA step";
  }
  if ((status === 403 || status === 404) && /not accessible by integration/i.test(message)) {
    return "the workflow's GITHUB_TOKEN has no `actions: read` permission";
  }
  if (status === 401) return "the token in GITHUB_TOKEN was rejected";
  return message || "no reason given";
}

export async function scheduledRunHealth({ token = process.env.GITHUB_TOKEN } = {}) {
  const slug = repoSlug();
  const url = `${API}/repos/${slug}/actions/workflows/${WORKFLOW}/runs?event=schedule&per_page=${WINDOW}`;
  const headers = { accept: "application/vnd.github+json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const { res, error } = await fetchOnce(url, { headers });

  if (!res) return [finding("minor", "could not ask GitHub about the scheduled runs", `${url}\n${error}`)];
  if (res.status !== 200) {
    // Not a product fault and not evidence about the runs: say so plainly
    // rather than reporting an outage this check cannot see.
    const body = await res.clone().json().catch(() => null);
    return [
      finding(
        "minor",
        `could not read the scheduled runs: GitHub answered ${res.status}`,
        [
          refusalReason(res.status, body, Boolean(token)),
          "",
          "This says nothing about whether the runs are healthy, only that this machine could not ask.",
          url,
        ].join("\n"),
      ),
    ];
  }

  let body;
  try {
    body = await res.json();
  } catch (err) {
    return [finding("minor", "GitHub's answer was not JSON", String(err?.message ?? err))];
  }

  return assess(body.workflow_runs ?? [], { wallMinutes: jobWallMinutes() });
}
