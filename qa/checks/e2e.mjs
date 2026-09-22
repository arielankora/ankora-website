// Browser end-to-end.
//
// Runs Playwright against a production build of this app on localhost,
// signed in as a seeded demo account in a throwaway database. Never
// against production: level 3 probes the live site read-only, but
// anything that clicks, types or writes happens somewhere disposable,
// because a permission test that books real time against a real client
// is not a test, it is an incident.

import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../lib/discover.mjs";
import { sh, tail } from "../lib/sh.mjs";
import { finding } from "../lib/report.mjs";

const REPORT = path.join(ROOT, "qa", "reports", "e2e.json");

export async function e2e() {
  fs.rmSync(REPORT, { force: true });

  // Re-seed immediately before the browser runs, every time.
  //
  // The CI job seeds once, up front - and then the integration suite runs
  // and TRUNCATEs every table, users included, because that is exactly
  // what resetDb() is for. By the time Playwright tried to sign in, the
  // demo accounts no longer existed, so the only spec that needed a real
  // session sat on the login screen until it timed out. A failed login
  // looked identical to a broken one.
  //
  // Seeding here rather than earlier in the workflow makes this check
  // self-sufficient: it does not care what ran before it, which is the
  // property any check in a suite this long needs to have.
  const seed = await sh("npm", ["run", "db:seed"], { timeoutMs: 3 * 60_000 });
  if (seed.code !== 0) {
    return [finding("blocker", "could not seed the fixtures the browser signs in as", tail(seed.all, 20))];
  }

  // No PLAYWRIGHT_BROWSERS_PATH default here, on purpose. An earlier
  // version defaulted it to /opt/pw-browsers - correct for the sandbox
  // this suite was written in, and wrong everywhere else. In CI,
  // `playwright install` puts Chromium in its own cache, and that
  // override then pointed Playwright at an empty directory: every spec
  // failed with "Executable doesn't exist", which reads like a broken
  // product and is really a broken assumption about one machine.
  //
  // sh() already inherits process.env, so an environment that genuinely
  // pre-installs browsers somewhere (the sandbox does) still works, and
  // one that does not gets Playwright's own default.
  const r = await sh("npx", ["playwright", "test", "-c", "qa/playwright.config.ts"], {
    timeoutMs: 25 * 60_000,
  });

  let report = null;
  try {
    report = JSON.parse(fs.readFileSync(REPORT, "utf8"));
  } catch {
    /* handled below */
  }

  if (!report) {
    return r.code === 0
      ? [finding("info", "browser suite passed but produced no report")]
      : [finding("blocker", "browser suite could not run", tail(r.all, 30))];
  }

  const specs = [];
  const walk = (suite) => {
    for (const s of suite.specs ?? []) specs.push(s);
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const s of report.suites ?? []) walk(s);

  const out = [];
  let passed = 0;
  const flakyNames = [];

  for (const spec of specs) {
    const results = (spec.tests ?? []).flatMap((t) => t.results ?? []);
    const status = spec.tests?.[0]?.status ?? "unknown";
    if (spec.ok && results.length > 1) {
      // The name AND why it failed the first time.
      //
      // "5 tests only passed on retry" is a number nobody can act on: it
      // says something is wrong without saying where, so it gets read,
      // noted and left. The name makes it findable; the first attempt's
      // error is the thing that actually ends the guessing, because a
      // passing retry throws that error away and the next run has to
      // reproduce it from nothing.
      const where = (spec.file ?? "").split("/").pop();
      const why = results.find((x) => x.error)?.error?.message ?? "";
      const oneLine = why.replace(/\s+/g, " ").trim().slice(0, 160);
      flakyNames.push(
        `${where ? `${where} — ` : ""}${spec.title}${oneLine ? `\n    first attempt: ${oneLine}` : ""}`,
      );
    }
    if (spec.ok) {
      passed += 1;
      continue;
    }
    if (status === "skipped") continue;
    const err = results.find((x) => x.error)?.error;
    out.push(
      finding("blocker", `browser: ${spec.title}`, [spec.file, err?.message ?? ""].filter(Boolean).join("\n").slice(0, 900)),
    );
  }

  // Flaky is reported, never swallowed. A test that passes on the retry
  // is a test nobody can trust the next time it goes red, and the whole
  // value of this suite is that red means something.
  if (flakyNames.length) {
    out.push(
      finding(
        "major",
        `${flakyNames.length} browser test(s) only passed on retry`,
        ["Flaky tests erode trust in every other result.", "", ...flakyNames].join("\n").slice(0, 1800),
      ),
    );
  }

  // Zero specs is not success. The first CI run reported the browser
  // check as green in 2.1 seconds, which is less time than it takes to
  // start a server - a suite that runs nothing passes everything, and
  // that is the single most dangerous state this file can be in.
  if (specs.length === 0) {
    out.push(
      finding("major", "browser suite ran no specs at all", tail(r.all, 30) || "no output from Playwright"),
    );
  }

  // When anything went wrong, keep the server's own output.
  //
  // Three consecutive runs failed on different write actions - a time
  // entry, an important date, a task - each one reported as "the form
  // did not do anything", which is what the browser can see and the
  // whole truth of what it can see. The next question is always the same
  // and has never been answerable from the report: what did the server
  // say while that click was in flight? Playwright pipes the app's
  // stderr into its own output, so the answer is already being produced
  // and then discarded.
  //
  // A Prisma pool timeout, an unhandled rejection, a slow query warning:
  // any of them turns "flaky suite" into a fact. Only on failure, so a
  // green run stays short.
  //
  // "minor", not "info": the PR comment filters info findings out
  // entirely, and evidence nobody reads is evidence nobody has. Twelve
  // lines because that is what the comment renders.
  // Timing first, and regardless of the verdict.
  //
  // The app logs one line per write that took longer than a person would
  // wait (lib/slow-log.ts). Those lines are the difference between "the
  // button stayed disabled" and "the overlap check took twenty-one
  // seconds", and they are worth reading on a green run too: a write
  // creeping towards the timeout is the run before the one that fails.
  const slow = String(r.all ?? "")
    .split("\n")
    .filter((l) => l.startsWith("[WebServer]"))
    .map((l) => l.replace(/^\[WebServer\]\s?/, "").trimEnd())
    .filter((l) => l.includes("[slow]"))
    .slice(0, 12);

  if (slow.length) {
    // The number decides the severity, not the fact: five hundred
    // milliseconds over the line is a note, five seconds is a fault
    // someone has to own.
    const worst = Math.max(...slow.map((l) => Number(/(\d+)ms/.exec(l)?.[1] ?? 0)));
    out.push(
      finding(
        worst >= 5000 ? "major" : "minor",
        `slow server work while the browser ran (worst ${worst}ms)`,
        slow.join("\n")
      )
    );
  }

  // Requests the browser abandoned, on every run.
  //
  // Reported outside the failure branch on purpose. Playwright retries a
  // failed test once, so a Server Action whose POST was aborted and which
  // then succeeded leaves a green run and no evidence - and three rounds
  // of this investigation were spent waiting to catch the fault in the
  // act. An abandoned request is worth knowing about whether or not it
  // happened to fail a test this time.
  const aborted = String(r.all ?? "")
    .split("\n")
    .map((l) => l.replace(/^\[WebServer\]\s?/, "").trimEnd())
    .filter((l) => l.includes("[abort]"))
    .slice(0, 12);

  if (aborted.length) {
    // A POST is a write the user asked for and did not get. A GET is
    // usually a prefetch the router cancelled on purpose, which is
    // ordinary Next behaviour and not worth waking anyone for.
    const writes = aborted.filter((l) => /\[abort\] POST/.test(l)).length;
    out.push(
      finding(
        writes ? "major" : "info",
        `${aborted.length} request(s) the browser abandoned${writes ? `, ${writes} of them a write` : ""}`,
        aborted.join("\n")
      )
    );
  }

  // The server's side of the same story, on every run, for the same
  // reason. These lines appear only while qa/playwright.config.ts sets
  // QA_TRACE, so they cost nothing anywhere else.
  const traced = String(r.all ?? "")
    .split("\n")
    .filter((l) => l.startsWith("[WebServer]"))
    .map((l) => l.replace(/^\[WebServer\]\s?/, "").trimEnd())
    .filter((l) => l.includes("[trace]"))
    .slice(-20);

  if (traced.length) {
    out.push(finding("minor", "what the server traced while the browser ran", traced.join("\n")));
  }

  if (out.some((f) => f.severity === "blocker" || f.severity === "major")) {
    // The error lines, not the last twelve lines.
    //
    // The first version took the tail, and the tail of a Node stack
    // trace is twelve frames of next-server internals - the one line
    // that says what actually went wrong is at the top, scrolled away.
    // This keeps the lines that name a fault and drops the frames, so
    // twelve lines of budget hold twelve distinct problems rather than
    // one problem's plumbing.
    //
    // Only [WebServer] lines. Playwright's own reporter writes to the
    // same stream, so without this the "what the app logged" block fills
    // up with the test failures printed directly above it - the one
    // thing the reader already has.
    const seen = new Set();
    const errors = String(r.all ?? "")
      .split("\n")
      .filter((l) => l.startsWith("[WebServer]"))
      .map((l) => l.replace(/^\[WebServer\]\s?/, "").trimEnd())
      .filter((l) => l && !/^\s+at\s/.test(l))
      .filter((l) => /error|invalid|timeout|ECONN|Prisma|denied|failed|unhandled/i.test(l))
      .filter((l) => {
        // Collapse repeats: one bad request repeated forty times is one
        // fact, and forty copies of it crowd out the other thirty-nine.
        const key = l.slice(0, 120);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 12);

    if (errors.length) {
      out.push(finding("minor", "what the app logged while the browser ran", errors.join("\n")));
    }

  }

  out.push(finding("info", `browser: ${passed}/${specs.length} specs passing`));
  return out;
}
