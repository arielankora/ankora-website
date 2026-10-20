import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SHARDS, MAIN_SHARD, shardOf, inShard, isShard, claimedCheckIds } from "../../qa/lib/shards.mjs";
import { Run } from "../../qa/lib/report.mjs";
import { readShards, missingShardChecks } from "../../qa/merge.mjs";
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

  it("writes only its own file, never last.json", () => {
    const run = new Run(3, { shard: "utc" });
    const out = run.persist();
    expect(out).toContain("shard-utc.json");
    expect(out).not.toContain("last.json");
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
