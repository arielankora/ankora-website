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
  let flaky = 0;

  for (const spec of specs) {
    const results = (spec.tests ?? []).flatMap((t) => t.results ?? []);
    const status = spec.tests?.[0]?.status ?? "unknown";
    if (spec.ok && results.length > 1) flaky += 1;
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
  if (flaky) {
    out.push(
      finding("major", `${flaky} browser test(s) only passed on retry`, "Flaky tests erode trust in every other result."),
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

  out.push(finding("info", `browser: ${passed}/${specs.length} specs passing`));
  return out;
}
