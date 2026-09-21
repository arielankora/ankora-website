import { defineConfig, devices } from "@playwright/test";

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
  workers: process.env.CI ? 2 : undefined,
  timeout: 30_000,
  expect: { timeout: 10_000 },

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
      testIgnore: [/auth\.setup\.ts$/, /\.app\.spec\.ts$/],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "app",
      testMatch: /\.app\.spec\.ts$/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: "qa/reports/.auth/employee.json" },
    },
  ],

  webServer: process.env.QA_BASE_URL
    ? undefined
    : {
        command: `npx next start -p ${PORT}`,
        url: `${BASE_URL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: "ignore",
        stderr: "pipe",
      },
});
