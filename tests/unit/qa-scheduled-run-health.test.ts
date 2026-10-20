import { describe, it, expect } from "vitest";
import { assess, jobWallMinutes, refusalReason, repoSlug } from "../../qa/checks/schedule.mjs";

/** The shape every check in qa/ reports in (qa/lib/report.mjs). */
type Finding = { severity: string; title: string; detail: string };

const findings = (out: unknown): Finding[] => out as Finding[];

/**
 * Pull out the one finding whose title matches, and fail loudly if it is
 * not there.
 *
 * `out.find(...)` returns undefined, and an assertion on undefined.detail
 * fails with a TypeError that names neither the finding that was expected
 * nor the ones that were produced. This suite has a standing complaint
 * about diagnostics that make you go and look; this is the cheap version
 * of not doing that.
 */
function must(out: unknown, titleFragment: string): Finding {
  const all = findings(out);
  const hit = all.find((f) => f.title.includes(titleFragment));
  if (!hit) throw new Error(`no finding titled like "${titleFragment}". Got: ${all.map((f) => f.title).join(" | ")}`);
  return hit;
}

// The watchdog over the scheduled runs (qa/checks/schedule.mjs).
//
// Everything here exercises the pure `assess`, never the network. A
// watchdog that can only be tested by letting a real run fail is a
// watchdog nobody tests, and this suite has been caught before by tests
// that depended on their environment.
//
// The shapes below are the ones GitHub actually returned for this
// repository between 11.10.2026 and 18.10.2026, trimmed to the fields
// the check reads.

type Row = {
  run_number: number;
  status: string;
  conclusion: string | null;
  run_started_at: string;
  updated_at: string;
  head_sha?: string;
  html_url?: string;
};

const run = (
  number: number,
  startedISO: string,
  minutes: number,
  conclusion: string | null,
  status = "completed",
): Row => ({
  run_number: number,
  status,
  conclusion,
  run_started_at: startedISO,
  updated_at: new Date(new Date(startedISO).getTime() + minutes * 60_000).toISOString(),
  head_sha: "0".repeat(40),
  html_url: `https://github.com/x/y/actions/runs/${number}`,
});

const titles = (out: unknown) => findings(out).map((f) => f.title);
const majors = (out: unknown) => findings(out).filter((f) => f.severity === "major");
const minors = (out: unknown) => findings(out).filter((f) => f.severity === "minor");

// A quiet week: seven green weekday runs, none near the wall.
function healthyWeek() {
  return [
    run(375, "2026-10-17T07:21:33Z", 32.9, "success"),
    run(367, "2026-10-16T07:43:28Z", 32.8, "success"),
    run(331, "2026-10-15T07:52:11Z", 21.3, "success"),
    run(321, "2026-10-14T08:14:52Z", 30.4, "success"),
    run(316, "2026-10-13T09:54:22Z", 25.4, "success"),
    run(305, "2026-10-12T10:01:29Z", 21.8, "success"),
    // 4.10 was a Sunday and it passed.
    run(228, "2026-10-04T09:09:00Z", 17.4, "success"),
  ];
}

const AFTER = new Date("2026-10-17T12:00:00Z");

describe("a healthy schedule", () => {
  it("says nothing alarming", () => {
    const out = assess(healthyWeek(), { wallMinutes: 90, now: AFTER });
    expect(majors(out)).toHaveLength(0);
    expect(minors(out)).toHaveLength(0);
    expect(findings(out).map((f) => f.severity)).toEqual(["info"]);
  });

  it("still summarises what it looked at", () => {
    const [info] = findings(assess(healthyWeek(), { wallMinutes: 90, now: AFTER }));
    expect(info.title).toContain("7 scheduled runs");
    expect(info.title).toContain("0 not successful");
  });
});

describe("the failure this check was written for", () => {
  // 11.10.2026: the Sunday level-3 run was stopped by the 45-minute wall
  // and reported as "cancelled". Six green weekday runs then piled on top
  // of it, and nobody noticed for a week.
  const theRealWeek = () => [...healthyWeek().slice(0, 6), run(299, "2026-10-11T09:31:00Z", 45.4, "cancelled")];

  it("fires on the grey Sunday even though every newer run is green", () => {
    const out = assess(theRealWeek(), { wallMinutes: 45, now: AFTER });
    const titled = titles(majors(out));
    expect(titled).toContain("the last weekly fault hunt cancelled");
  });

  it("explains why a green list hid it", () => {
    const out = assess(theRealWeek(), { wallMinutes: 45, now: AFTER });
    const hunt = must(out, "weekly fault hunt");
    expect(hunt.detail).toContain("level-3");
    expect(hunt.detail).toContain("#299");
  });

  it("does not fire when that same Sunday passed", () => {
    const fixed = [...healthyWeek().slice(0, 6), run(299, "2026-10-11T09:31:00Z", 38, "success")];
    expect(majors(assess(fixed, { wallMinutes: 90, now: AFTER }))).toHaveLength(0);
  });
});

describe("the newest run", () => {
  it("is reported when it did not pass", () => {
    const out = assess([run(406, "2026-10-18T07:36:04Z", 45.4, "cancelled")], {
      wallMinutes: 45,
      now: new Date("2026-10-18T09:00:00Z"),
    });
    expect(titles(majors(out))).toContain("the last scheduled run cancelled");
  });

  it("spells out that cancelled can mean the wall, not a person", () => {
    const out = assess([run(406, "2026-10-18T07:36:04Z", 45.4, "cancelled")], {
      wallMinutes: 45,
      now: new Date("2026-10-18T09:00:00Z"),
    });
    expect(must(out, "last scheduled run").detail).toContain("maximum execution time");
  });

  it("is not reported twice when it is also the Sunday run", () => {
    // 18.10 was a Sunday. One finding, not two.
    const out = assess([run(406, "2026-10-18T07:36:04Z", 45.4, "cancelled")], {
      wallMinutes: 45,
      now: new Date("2026-10-18T09:00:00Z"),
    });
    expect(majors(out)).toHaveLength(1);
  });

  it("names a plain failure without the cancellation note", () => {
    const out = assess([run(410, "2026-10-19T08:00:00Z", 20, "failure")], {
      wallMinutes: 90,
      now: new Date("2026-10-19T10:00:00Z"),
    });
    const f = must(out, "last scheduled run");
    expect(f.title).toContain("failure");
    expect(f.detail).not.toContain("maximum execution time");
  });
});

describe("a schedule that stopped firing", () => {
  it("is reported after a day and a half of silence", () => {
    const out = assess([run(375, "2026-10-17T07:21:33Z", 32.9, "success")], {
      wallMinutes: 90,
      now: new Date("2026-10-19T00:00:00Z"), // ~40h later
    });
    expect(titles(majors(out)).some((t) => t.startsWith("no scheduled run in"))).toBe(true);
  });

  it("tolerates GitHub deferring a run by a few hours", () => {
    // The real runs are written for 03:00 UTC and start between 07:21 and
    // 10:01. A day of that must not look like an outage.
    const out = assess([run(375, "2026-10-17T07:21:33Z", 32.9, "success")], {
      wallMinutes: 90,
      now: new Date("2026-10-18T10:01:00Z"), // ~27h later, the worst real gap
    });
    expect(majors(out)).toHaveLength(0);
  });
});

describe("headroom against the wall", () => {
  it("warns before a run is cut off, not after", () => {
    // 34 of 45 is 76%, under the line. 37 of 45 is 82%, over it.
    const under = assess([run(1, "2026-10-17T08:00:00Z", 34, "success")], { wallMinutes: 45, now: AFTER });
    expect(minors(under)).toHaveLength(0);

    const over = assess([run(2, "2026-10-17T08:00:00Z", 37, "success")], { wallMinutes: 45, now: AFTER });
    expect(minors(over)).toHaveLength(1);
    expect(minors(over)[0].title).toContain("82% of the 45-minute wall");
  });

  it("would have spoken up a week before the hunt was first cut off", () => {
    // This is the claim worth testing. On 11.10 the wall was still 45 and
    // the weekday runs were already past 36 minutes. Every number was
    // there; nothing was reading them.
    const out = assess([run(305, "2026-10-12T10:01:29Z", 38, "success")], { wallMinutes: 45, now: AFTER });
    expect(minors(out)).toHaveLength(1);
  });

  it("says nothing when the wall cannot be read", () => {
    const out = assess([run(1, "2026-10-17T08:00:00Z", 80, "success")], { wallMinutes: null, now: AFTER });
    expect(minors(out)).toHaveLength(0);
    expect(findings(out)[0].detail).toContain("could not be read");
  });

  it("counts how many runs are that close", () => {
    const out = assess(
      [run(1, "2026-10-17T08:00:00Z", 40, "success"), run(2, "2026-10-16T08:00:00Z", 38, "success")],
      { wallMinutes: 45, now: AFTER },
    );
    expect(minors(out)[0].detail).toContain("2 of the last 2");
  });
});

describe("rows the check must ignore", () => {
  it("skips a run that is still going", () => {
    const rows = [
      { ...run(500, "2026-10-18T08:00:00Z", 0, null, "in_progress") },
      run(375, "2026-10-17T07:21:33Z", 32.9, "success"),
    ];
    const out = assess(rows, { wallMinutes: 90, now: AFTER });
    expect(majors(out)).toHaveLength(0);
    expect(findings(out)[0].title).toContain("1 scheduled runs");
  });

  it("has something to say when there is nothing to look at", () => {
    const out = assess([], { wallMinutes: 90, now: AFTER });
    expect(findings(out)).toHaveLength(1);
    expect(findings(out)[0].severity).toBe("minor");
  });
});

describe("reading the wall out of the workflow", () => {
  it("takes the job's value, not the step's", () => {
    const yaml = ["jobs:", "  qa:", "    timeout-minutes: 90", "    steps:", "      - name: Run QA", "        timeout-minutes: 75", ""].join("\n");
    expect(jobWallMinutes(yaml)).toBe(90);
  });

  it("is not just taking whichever value comes first", () => {
    // The case above cannot tell an indent-aware regex from a lazy one,
    // because in the real file the job's key happens to come first. Here
    // the step's budget is written above the job's wall, so only reading
    // the indentation gets it right. Found by mutating the regex and
    // watching every test still pass.
    const yaml = [
      "jobs:",
      "  qa:",
      "    steps:",
      "      - name: Run QA",
      "        timeout-minutes: 75",
      "    timeout-minutes: 90",
      "",
    ].join("\n");
    expect(jobWallMinutes(yaml)).toBe(90);
  });

  it("reads the checks job's wall, not whichever job is written first", () => {
    // 20.10.2026: the workflow gained a cheap "level" job above the heavy
    // one. A regex that took the first four-space timeout-minutes in the
    // file would report that job's wall and would have the headroom
    // warning measuring the wrong thing forever.
    const yaml = [
      "jobs:",
      "  level:",
      "    runs-on: ubuntu-latest",
      "    timeout-minutes: 5",
      "  qa:",
      "    runs-on: ubuntu-latest",
      "    timeout-minutes: 60",
      "  report:",
      "    timeout-minutes: 10",
      "",
    ].join("\n");
    expect(jobWallMinutes(yaml)).toBe(60);
    expect(jobWallMinutes(yaml, "level")).toBe(5);
    expect(jobWallMinutes(yaml, "report")).toBe(10);
  });

  it("falls back to the whole file when there is no job by that name", () => {
    const yaml = ["jobs:", "  other:", "    timeout-minutes: 42", ""].join("\n");
    expect(jobWallMinutes(yaml)).toBe(42);
  });

  it("ignores a step budget when the job has no wall of its own", () => {
    const yaml = ["jobs:", "  qa:", "    steps:", "      - timeout-minutes: 75", ""].join("\n");
    expect(jobWallMinutes(yaml)).toBe(null);
  });

  it("returns null rather than a guess when the key is absent", () => {
    expect(jobWallMinutes("jobs:\n  qa:\n    steps: []\n")).toBe(null);
  });

  it("reads the real workflow in this repository", () => {
    // Guards the regex against a reindent of qa.yml.
    expect(jobWallMinutes()).toBeGreaterThan(0);
  });
});

describe("knowing which repository this is", () => {
  it("prefers the Actions environment", () => {
    expect(repoSlug({ GITHUB_REPOSITORY: "owner/name" })).toBe("owner/name");
  });

  it("falls back to the git remote", () => {
    expect(repoSlug({})).toBe("arielankora/ankora-website");
  });
});

describe("when GitHub refuses to answer", () => {
  // The two 403s mean opposite things. Telling them apart is the whole
  // value of the line the check prints: one says "add a permission", the
  // other says "you had no token at all". The first version of this
  // check reported both as a bare status code, and the sandbox hit the
  // rate limit within a minute of it being written.
  it("names a missing actions:read permission", () => {
    expect(refusalReason(403, { message: "Resource not accessible by integration" }, true)).toContain(
      "actions: read",
    );
  });

  it("distinguishes an anonymous rate limit from an exhausted repository budget", () => {
    const anon = refusalReason(403, { message: "API rate limit exceeded for 34.58.4.212." }, false);
    const auth = refusalReason(403, { message: "API rate limit exceeded" }, true);
    expect(anon).toContain("60 an hour");
    expect(anon).toContain("GITHUB_TOKEN");
    expect(auth).toContain("repository's hourly API budget");
    expect(auth).not.toContain("60 an hour");
  });

  it("names a rejected token", () => {
    expect(refusalReason(401, { message: "Bad credentials" }, true)).toContain("rejected");
  });

  it("falls back to GitHub's own words rather than inventing a cause", () => {
    expect(refusalReason(500, { message: "Server Error" }, true)).toBe("Server Error");
    expect(refusalReason(500, null, true)).toBe("no reason given");
  });
});
