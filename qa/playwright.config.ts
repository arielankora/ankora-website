import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

// Browser end-to-end configuration.
//
// Deliberately narrow: one browser, one viewport by default, run against
// a production build of this app on localhost. This suite's job is to
// answer "does the product still work", not "does it work in Safari 14" -
// cross-browser matrices are a different question with a much worse
// time-to-signal, and a slow suite is a suite that gets skipped.
//
// It never runs against production. Level 3 probes the live site
// read-only (see qa/checks/production.mjs); everything that clicks,
// types or writes happens against a throwaway database, because a
// permission test that books real time against a real client is not a
// test, it is an incident.

const PORT = Number(process.env.QA_PORT ?? 3100);
const BASE_URL = process.env.QA_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./reports/e2e-artifacts",
  // The whole suite, not the first failure: one run should tell you
  // everything that is broken, so you fix it in one pass rather than
  // discovering the next problem on the next commit.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // One retry in CI only. Enough to absorb a genuinely flaky network
  // hiccup; not enough to hide a test that fails half the time - the
  // report still marks it flaky, which is the signal worth keeping.
  retries: process.env.CI ? 1 : 0,
  // One worker in CI. Every spec that writes shares ONE database and ONE
  // build, and two of them at once made three different tests flake on
  // different runs - each time looking like a fault in the screen under test
  // rather than contention. Same lesson the integration suite learned in #76,
  // arriving through a different door. The suite costs a couple of minutes
  // more and stops lying.
  workers: process.env.CI ? 1 : undefined,
  timeout: 30_000,
  expect: { timeout: 10_000 },

  // Resolve `@/...` through the app's tsconfig, explicitly.
  //
  // Playwright otherwise picks whichever tsconfig sits nearest the spec file,
  // which today happens to be the right one and tomorrow might not. routes.ts
  // reads the published customer stories from the same module the site renders
  // from, so an unresolved alias there does not fail one assertion - it fails
  // collection for every spec that imports routes.ts, which reads like the
  // whole suite broke.
  tsconfig: path.resolve(__dirname, "..", "tsconfig.json"),

  reporter: process.env.CI
    ? [["list"], ["json", { outputFile: "./reports/e2e.json" }]]
    : [["list"]],

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    // The product is Hebrew-first and right-to-left. Testing it in a
    // US-English locale would miss exactly the layout and formatting
    // faults that matter most here.
    locale: "he-IL",
    timezoneId: "Asia/Jerusalem",
  },

  projects: [
    // Signs in once and saves the session, so the ~27 authenticated
    // screens below do not each pay for a login round-trip.
    { name: "setup", testMatch: /auth\.setup\.ts$/ },
    {
      name: "public",
      testIgnore: [/auth\.setup\.ts$/, /\.app\.spec\.ts$/, /\.super\.spec\.ts$/, /\.client\.spec\.ts$/],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "app",
      testMatch: /\.app\.spec\.ts$/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: "qa/reports/.auth/employee.json" },
    },
    // The Super-Admin-only surfaces get their own session rather than their
    // own login per spec, for the same reason the one above exists.
    {
      name: "app-super",
      testMatch: /\.super\.spec\.ts$/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: "qa/reports/.auth/superadmin.json" },
    },
    // And the one capability that belongs to a client-side user rather than
    // to Ankora staff - see the third setup in auth.setup.ts.
    {
      name: "app-client",
      testMatch: /\.client\.spec\.ts$/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: "qa/reports/.auth/clientadmin.json" },
    },
  ],

  webServer: process.env.QA_BASE_URL
    ? undefined
    : {
        command: `npx next start -p ${PORT}`,
        // Playwright defaults a webServer's cwd to the directory holding
        // this config file - so `next start` ran inside qa/, found no
        // .next there, and died before a single spec was collected. The
        // check reported green in two seconds, because a run that
        // collects nothing fails nothing.
        //
        // `__dirname`, not `import.meta.dirname`: Playwright compiles this
        // config to CommonJS, and a single `import.meta` in the file flips
        // its loader into ESM handling, which then dies on the `exports`
        // the compiler just emitted.
        cwd: path.resolve(__dirname, ".."),
        url: `${BASE_URL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: "ignore",
        stderr: "pipe",
      },
});
