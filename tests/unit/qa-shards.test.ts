import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SHARDS, MAIN_SHARD, ALWAYS, shardOf, inShard, isShard, claimedCheckIds } from "../../qa/lib/shards.mjs";
import { Run } from "../../qa/lib/report.mjs";
import { readShards, missingShardChecks, dedupe } from "../../qa/merge.mjs";
import { shardPlan } from "../../qa/checks/static.mjs";

type Finding = { severity: string; title: string; detail: string };
type Check = { id: string; label: string; status: string; blocking: boolean; ms: number; findings: Finding[] };

const payload = (shard: string, startedAt: string, durationMs: number, checks: Partial<Check>[]) => ({
  shard,
  summary: { startedAt, durationMs },
  checks: checks.map((c) => ({ status: "pass", blocking: true, ms: 0, findings: [], label: c.id, ...c })) as Check[],
});

describe("the shard plan", () => {
  it("gives every heavy pass its own shard and sends the rest to main", () => {
    expect(shardOf("integration")).toBe("integration");
    expect(shardOf("integration-utc")).toBe("utc");
    expect(shardOf("coverage")).toBe("coverage");
    // Unclaimed ids fall to main rather than disappearing. A check that is
    // forgotten here must still run somewhere.
    expect(shardOf("e2e")).toBe(MAIN_SHARD);
    expect(shardOf("a-check-nobody-wrote-yet")).toBe(MAIN_SHARD);
  });

  it("runs everything when no shard is set", () => {
    for (const id of ["integration", "coverage", "e2e"]) expect(inShard(id, null)).toBe(true);
  });

  it("claims each check exactly once", () => {
    const ids = claimedCheckIds();
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("knows its own names and refuses anything else", () => {
    for (const s of SHARDS) expect(isShard(s)).toBe(true);
    expect(isShard("main-ish")).toBe(false);
    expect(isShard("")).toBe(false);
  });

  // The guard that matters: shards name checks by id, and nothing but this
  // check ties those strings to qa/run.mjs. A rename there would leave a
  // shard that matches nothing, which runs nothing and reports a pass.
  it("matches the ids qa/run.mjs actually declares", async () => {
    expect(await shardPlan()).toEqual([]);
  });
});

describe("Run, sharded", () => {
  it("does not record a check that belongs to another shard", async () => {
    const run = new Run(3, { shard: "coverage" });
    await run.check("integration", { label: "Integration tests", level: 2 }, async () => []);
    await run.check("coverage", { label: "Executed coverage", level: 3 }, async () => []);
    // Not "skipped": a row per foreign check would appear in every merged
    // report and would make the incomplete rule fire on a healthy run.
    expect(run.checks.map((c) => c.id)).toEqual(["coverage"]);
  });

  it("still applies the level cut inside a shard", async () => {
    const run = new Run(2, { shard: "coverage" });
    await run.check("coverage", { label: "Executed coverage", level: 3 }, async () => []);
    expect(run.checks).toEqual([]);
  });

  // persist() writes into the real qa/reports and appends to the real job
  // summary, so this test has to clean up after itself. Run #510 is why:
  // this very test left a shard-utc.json in qa/reports inside the `main`
  // job, the job's artefact carried it, and the merge then had two files
  // claiming to be the utc shard. A unit test is not allowed to put
  // evidence into the run it is being run by.
  it("writes only its own file, never last.json", () => {
    const summary = process.env.GITHUB_STEP_SUMMARY;
    delete process.env.GITHUB_STEP_SUMMARY;
    const file = path.join(process.cwd(), "qa", "reports", "shard-utc.json");
    const existed = fs.existsSync(file);
    try {
      const run = new Run(3, { shard: "utc" });
      const out = run.persist();
      expect(out).toContain("shard-utc.json");
      expect(out).not.toContain("last.json");
    } finally {
      if (!existed) fs.rmSync(file, { force: true });
      if (summary !== undefined) process.env.GITHUB_STEP_SUMMARY = summary;
    }
  });
});

describe("merging the shards", () => {
  it("reports wall clock, not the sum of the shards", () => {
    const run = Run.fromShards(3, [
      payload("main", "2026-10-25T03:00:00.000Z", 11 * 60_000, [{ id: "unit" }]),
      payload("integration", "2026-10-25T03:00:30.000Z", 21 * 60_000, [{ id: "integration" }]),
      payload("coverage", "2026-10-25T03:00:10.000Z", 22 * 60_000, [{ id: "coverage" }]),
    ]);
    // Latest end is coverage at 03:00:10 + 22m = 03:22:10; earliest start
    // 03:00:00. Summing would say 54 minutes and would have the headroom
    // watchdog reporting a wall nothing is near.
    expect(run.summary().durationMs).toBe(22 * 60_000 + 10_000);
    expect(run.checks.map((c) => c.id).sort()).toEqual(["coverage", "integration", "unit"]);
  });

  it("fails the run when a shard never reported", () => {
    const found = new Map([["main", payload("main", "2026-10-25T03:00:00.000Z", 1000, [{ id: "unit" }])]]);
    const rows = missingShardChecks(["main", "coverage"], found, []);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("shard-coverage");
    expect(rows[0].blocking).toBe(true);
    expect(rows[0].findings[0].severity).toBe("blocker");

    const run = Run.fromShards(3, [...found.values()]);
    run.checks = [...run.checks, ...rows];
    expect(run.failed).toBe(true);
    expect(run.verdict).toBe("FAIL");
  });

  it("passes when every expected shard is there", () => {
    const found = new Map([
      ["main", payload("main", "2026-10-25T03:00:00.000Z", 1000, [{ id: "unit" }])],
      ["coverage", payload("coverage", "2026-10-25T03:00:00.000Z", 1000, [{ id: "coverage" }])],
    ]);
    expect(missingShardChecks(["main", "coverage"], found, [])).toEqual([]);
  });

  it("ignores a report with no rows in it, so a stray file cannot shadow a shard", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-merge-"));
    fs.mkdirSync(path.join(dir, "real"), { recursive: true });
    fs.mkdirSync(path.join(dir, "stray"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "real", "shard-utc.json"),
      JSON.stringify(payload("utc", "2026-10-25T03:00:00.000Z", 1000, [{ id: "integration-utc" }])),
    );
    // Later timestamp, no checks: exactly what a unit test's persist() left
    // in the main shard's artefact in run #510.
    fs.writeFileSync(
      path.join(dir, "stray", "shard-utc.json"),
      JSON.stringify(payload("utc", "2026-10-25T09:00:00.000Z", 0, [])),
    );
    const { found } = readShards(dir);
    expect(found.get("utc")!.checks.map((c: Check) => c.id)).toEqual(["integration-utc"]);
  });

  it("fails a shard that reported without the check it owns", () => {
    const found = new Map([["utc", payload("utc", "2026-10-25T03:00:00.000Z", 1000, [{ id: "preflight" }])]]);
    const rows = missingShardChecks(["utc"], found, []);
    expect(rows).toHaveLength(1);
    expect(rows[0].findings[0].title).toContain("integration-utc");
    expect(rows[0].blocking).toBe(true);
  });

  it("calls an unreadable report a blocker rather than dropping it", () => {
    const rows = missingShardChecks([], new Map(), ["shard-utc.json: Unexpected end of JSON input"]);
    expect(rows).toHaveLength(1);
    expect(rows[0].findings[0].severity).toBe("blocker");
  });

  it("finds shard files however deeply the artefact download nested them", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-merge-"));
    const nested = path.join(dir, "qa-report-level-3-utc", "qa", "reports");
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(
      path.join(nested, "shard-utc.json"),
      JSON.stringify(payload("utc", "2026-10-25T03:00:00.000Z", 1000, [{ id: "integration-utc" }])),
    );
    const { found, broken } = readShards(dir);
    expect([...found.keys()]).toEqual(["utc"]);
    expect(broken).toEqual([]);
  });

  it("keeps the later report when a re-run left an old one behind", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-merge-"));
    fs.mkdirSync(path.join(dir, "old"), { recursive: true });
    fs.mkdirSync(path.join(dir, "new"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "old", "shard-main.json"),
      JSON.stringify(payload("main", "2026-10-25T03:00:00.000Z", 1000, [{ id: "stale" }])),
    );
    fs.writeFileSync(
      path.join(dir, "new", "shard-main.json"),
      JSON.stringify(payload("main", "2026-10-25T09:00:00.000Z", 1000, [{ id: "fresh" }])),
    );
    const { found } = readShards(dir);
    expect(found.get("main")!.checks[0].id).toBe("fresh");
  });
});

describe("preflight in every shard", () => {
  // Run #508, 20.10.2026: utc, integration and coverage all reported
  // success with "Run QA" at 0 seconds. preflight is what fills
  // `capabilities`, every skipIf reads it, and it lived in `main` alone -
  // so the other three saw a machine with no database and skipped
  // everything they own. Green, instant, and nothing tested.
  it("runs in every shard, not only the one that owns it", () => {
    for (const s of SHARDS) expect(inShard("preflight", s)).toBe(true);
    expect(ALWAYS).toContain("preflight");
  });

  it("appears once in the merged table, keeping the worst row", () => {
    const row = (status: string, findings: Finding[] = []) => ({
      id: "preflight",
      label: "Environment preflight",
      status,
      blocking: false,
      ms: 0,
      findings,
    });
    const merged = dedupe([
      row("pass"),
      { id: "integration", label: "i", status: "pass", blocking: true, ms: 0, findings: [] },
      row("warn", [{ severity: "major", title: "no browser available", detail: "" }]),
      row("pass"),
    ]);
    expect(merged.filter((c) => c.id === "preflight")).toHaveLength(1);
    expect(merged.find((c) => c.id === "preflight")!.status).toBe("warn");
    // Order is preserved: preflight keeps the slot it first appeared in.
    expect(merged.map((c) => c.id)).toEqual(["preflight", "integration"]);
  });

  it("does not collapse two different checks that share a status", () => {
    const c = (id: string) => ({ id, label: id, status: "pass", blocking: true, ms: 0, findings: [] });
    expect(dedupe([c("integration"), c("coverage")]).map((x) => x.id)).toEqual(["integration", "coverage"]);
  });
});
