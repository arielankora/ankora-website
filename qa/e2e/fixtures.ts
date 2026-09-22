import { test as base } from "@playwright/test";
import { observe, pageDrift, trafficSummary } from "./observe";

// Every write flow, observed - because the failures move.
//
// One commit produced two opposite runs. In the first, the important-date
// drawer hung for thirty seconds and everything else passed. In the
// second, the drawer was fine and six specs in two other files failed
// their first attempt, every one of them on a variant of "the row is not
// on the screen yet". Twelve minutes against seven.
//
// A diagnostic wired into the one spec that failed yesterday answers
// nothing about that, and moving it by hand after each run is how a suite
// ends up measuring its own history. So it is a fixture: any spec that
// imports `test` from here records the traffic, the page's own timer
// drift and the machine's load, and if the test fails, that evidence is
// appended to the failure rather than kept for a spec that happened to
// ask for it.
//
// It costs one 100ms interval in the page and a few event listeners, and
// prints nothing at all on a green run.
export const test = base.extend({
  // `runTest`, not Playwright's usual `use`: the lint rules this repo
  // shares with the app read a call to `use(...)` as a React hook and
  // refuse the file. The name is positional here, so it costs nothing.
  page: async ({ page }, runTest, testInfo) => {
    observe(page);
    await runTest(page);

    if (testInfo.status === testInfo.expectedStatus) return;

    // The page is still open here, which is the only reason the drift
    // probe can be read at all - a teardown that ran after the context
    // closed would report every failure as "not measured".
    const conditions = `${trafficSummary(page)}. ${await pageDrift(page)}`;
    const first = testInfo.errors[0];
    if (first) first.message = `${first.message ?? ""}\n\nbrowser conditions: ${conditions}`;
    else testInfo.errors.push({ message: `browser conditions: ${conditions}` });
  },
});

export { expect } from "@playwright/test";
