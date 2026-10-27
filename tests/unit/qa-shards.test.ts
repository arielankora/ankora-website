import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MAIN_SHARD, ALWAYS, shardOf, inShard, isShard, claimedCheckIds, shardsFor, splitFor, checksOwnedBy } from "../../qa/lib/shards.mjs";

// qa/lib/shards.mjs is plain JavaScript, so everything it returns arrives as
// `any` and a callback parameter taken from it is an implicit any. `next
// build` type-checks this directory, so that is a failed build, not a lint
// nit: it cost run #530 its `main` shard, its production build and its
// browser suite, from one missing annotation.
const shardNames = (level: number): string[] => shardsFor(level) as string[];
import { Run } from "../../qa/lib/report.mjs";
import { readShards, missingShardChecks, dedupe, coverageRows } from "../../qa/merge.mjs";
import { mergeFinals, modulesOf, suiteFiles, partFiles } from "../../qa/checks/coverage.mjs";
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
    expect(shardOf("integration-utc", 3)).toBe("utc-1");
    expect(shardOf("coverage", 3)).toBe("coverage-1");
    // Unclaimed ids fall to main rather than disappearing. A check that is
    // forgotten here must still run somewhere.
    expect(shardOf("e2e", 3)).toBe(MAIN_SHARD);
    expect(shardOf("a-check-nobody-wrote-yet", 3)).toBe(MAIN_SHARD);
  });

  it("runs everything when no shard is set", () => {
    for (const id of ["integration", "coverage", "e2e"]) expect(inShard(id, null, 3)).toBe(true);
  });

  it("claims each check exactly once", () => {
    const ids = claimedCheckIds();
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("knows its own names and refuses anything else", () => {
    for (const s of shardNames(3)) expect(isShard(s)).toBe(true);
    expect(isShard("main-ish")).toBe(false);
    expect(isShard("")).toBe(false);
  });

  // The bug this caught while being written: three shards claim one check,
  // and a map keyed one-shard-per-id kept whichever came last. integration-1
  // and integration-2 owned nothing and would have run no tests at all.
  it("lets three shards share one check", () => {
    for (const s of ["integration-1", "integration-2", "integration-3"]) {
      expect(inShard("integration", s, 3), s).toBe(true);
      expect(checksOwnedBy(s)).toEqual(["integration"]);
    }
    expect(inShard("integration", MAIN_SHARD, 3)).toBe(false);
  });

  // Every split check is covered exactly once, with no gap and no overlap.
  //
  // Written on 25.10.2026 with the UTC split, and general on purpose rather
  // than named after `utc`: the previous test proves three shards can share
  // a check, and this proves the shares add up. A typo that gave two shards
  // `[1, 3]` would leave a third of the suite unrun and a third run twice,
  // and both halves of that are silent - the run is green either way, and
  // "91 files" never appears anywhere to be compared against.
  //
  // The arithmetic is the whole guard: k from 1 to n, each exactly once,
  // all shards of one check agreeing on n.
  it("gives a split check every k of n, once", () => {
    const splitsByCheck = new Map<string, [number, number][]>();
    for (const shard of shardNames(3)) {
      const split = splitFor(shard) as [number, number] | null;
      if (!split) continue;
      for (const id of checksOwnedBy(shard) as string[]) {
        if (!splitsByCheck.has(id)) splitsByCheck.set(id, []);
        splitsByCheck.get(id)!.push(split);
      }
    }

    // Non-vacuous: if the plan stops splitting anything, say so here rather
    // than passing an empty loop.
    expect([...splitsByCheck.keys()].sort()).toEqual(["coverage", "integration", "integration-utc"]);

    for (const [id, splits] of splitsByCheck) {
      const totals = new Set(splits.map(([, n]) => n));
      expect(totals.size, `${id}: its shards disagree about how many pieces there are`).toBe(1);
      const n = [...totals][0];
      expect(splits.length, `${id}: ${splits.length} shard(s) for a ${n}-way split`).toBe(n);
      const ks = splits.map(([k]) => k).sort((a, b) => a - b);
      expect(ks, `${id}: the pieces do not add up`).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    }
  });

  it("hands each integration shard a different third of the suite", () => {
    expect(splitFor("integration-1")).toEqual([1, 3]);
    expect(splitFor("integration-2")).toEqual([2, 3]);
    expect(splitFor("integration-3")).toEqual([3, 3]);
    // 25.10.2026: the UTC pass is sharded on the same three-way split, and
    // for the same reason one level down - it reached 19.8 minutes against a
    // 20-minute budget, and a budget overrun is a blocker by design.
    expect(splitFor("utc-1")).toEqual([1, 3]);
    expect(splitFor("utc-2")).toEqual([2, 3]);
    expect(splitFor("utc-3")).toEqual([3, 3]);
    // 27.10.2026: coverage too, at 38.9 minutes of a 40-minute budget on
    // run #602. Its parts are judged together in qa/merge.mjs.
    expect(splitFor("coverage-1")).toEqual([1, 3]);
    expect(splitFor("coverage-2")).toEqual([2, 3]);
    expect(splitFor("coverage-3")).toEqual([3, 3]);
    // A shard that runs its checks whole has no split to pass to vitest.
    expect(splitFor(MAIN_SHARD)).toBeNull();
  });

  // The guard that matters: shards name checks by id, and nothing but this
  // check ties those strings to qa/run.mjs. A rename there would leave a
  // shard that matches nothing, which runs nothing and reports a pass.
  it("matches the ids qa/run.mjs actually declares", async () => {
    expect(await shardPlan()).toEqual([]);
  });
});

describe("which shards a level runs as", () => {
  it("never splits level 1", () => {
    // Two minutes of checks. Four job setups to save one would be a worse
    // gate, not a faster one.
    expect(shardsFor(1)).toBeNull();
  });

  it("splits level 2, because that is the one that runs every night", () => {
    expect(shardsFor(2)).toEqual(["main", "integration-1", "integration-2", "integration-3"]);
  });

  it("splits level 3 further, for the passes only it runs", () => {
    expect(shardsFor(3)).toContain("coverage-1");
    expect(shardsFor(3)).toContain("coverage-2");
    expect(shardsFor(3)).toContain("coverage-3");
    // The old single shard is gone, not left beside its parts: it would run
    // the whole suite a fourth time and judge it on its own.
    expect(shardsFor(3)).not.toContain("coverage");
    expect(shardsFor(3)).toContain("utc-1");
    expect(shardsFor(3)).toContain("utc-2");
    expect(shardsFor(3)).toContain("utc-3");
  });

  // The rule that keeps a check from falling out of the plan: level 2 has no
  // `utc-*` shard, so integration-utc runs in main rather than nowhere. Its
  // twelve date-sensitive files are about four minutes; a job setup for them
  // would cost more than it saves.
  it("sends a check to main when this level does not run its shard", () => {
    expect(shardOf("integration-utc", 2)).toBe(MAIN_SHARD);
    expect(inShard("integration-utc", MAIN_SHARD, 2)).toBe(true);
    expect(inShard("integration-utc", MAIN_SHARD, 3)).toBe(false);
  });

  it("leaves no check without a shard at any level", () => {
    for (const level of [2, 3]) {
      for (const id of [...claimedCheckIds(), "e2e", "unit", "build"]) {
        const homes = shardNames(level).filter((s) => inShard(id, s, level));
        expect(homes.length, `${id} at level ${level}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("Run, sharded", () => {
  it("does not record a check that belongs to another shard", async () => {
    const run = new Run(3, { shard: "coverage-1" });
    await run.check("integration", { label: "Integration tests", level: 2 }, async () => []);
    await run.check("coverage", { label: "Executed coverage", level: 3 }, async () => []);
    // Not "skipped": a row per foreign check would appear in every merged
    // report and would make the incomplete rule fire on a healthy run.
    expect(run.checks.map((c) => c.id)).toEqual(["coverage"]);
  });

  it("still applies the level cut inside a shard", async () => {
    const run = new Run(2, { shard: "coverage-1" });
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
    const found = new Map([["utc-1", payload("utc-1", "2026-10-25T03:00:00.000Z", 1000, [{ id: "preflight" }])]]);
    const rows = missingShardChecks(["utc-1"], found, []);
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
    for (const level of [2, 3])
      for (const s of shardNames(level)) expect(inShard("preflight", s, level), `${s} at level ${level}`).toBe(true);
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

describe("coverage, split and merged", () => {
  // Typed views of plain-JS returns, for the same reason as shardNames above.
  type ModuleCov = { functions: number; covered: number; pct: number; missed: string[] };
  type FileCov = { fnMap: Record<string, unknown>; s: Record<string, number>; b: Record<string, number[]> };
  const modules = (f: unknown) => modulesOf(f) as Record<string, ModuleCov>;
  const merge = (finals: unknown[]) => mergeFinals(finals) as Record<string, FileCov>;

  // One measured module, two functions, in the shape V8 coverage writes.
  const root = process.cwd();
  const loc = (line: number) => ({ start: { line, column: 0 }, end: { line: line + 2, column: 1 } });
  const fileCov = (counts: [number, number], order: "ab" | "ba" = "ab") => {
    const fns = { a: { name: "alpha", decl: loc(1), loc: loc(1) }, b: { name: "beta", decl: loc(5), loc: loc(5) } };
    const ids = order === "ab" ? (["a", "b"] as const) : (["b", "a"] as const);
    const byName = { a: counts[0], b: counts[1] };
    return {
      path: path.join(root, "lib/app-domain/fake.ts"),
      fnMap: Object.fromEntries(ids.map((k, i) => [String(i), fns[k]])),
      f: Object.fromEntries(ids.map((k, i) => [String(i), byName[k]])),
      statementMap: { "0": loc(2), "1": loc(6) },
      s: { "0": counts[0], "1": counts[1] },
      branchMap: { "0": { type: "if", loc: loc(2), locations: [loc(2), loc(3)] } },
      b: { "0": [counts[0], 0] },
    };
  };
  const final = (counts: [number, number], order: "ab" | "ba" = "ab") => ({
    [path.join(root, "lib/app-domain/fake.ts")]: fileCov(counts, order),
  });

  // The reason the parts cannot judge themselves: each one sees half.
  it("counts a function run by any part as run", () => {
    const one = modules(final([3, 0]))["lib/app-domain/fake.ts"];
    const two = modules(final([0, 2]))["lib/app-domain/fake.ts"];
    expect(one.covered).toBe(1);
    expect(two.covered).toBe(1);
    const merged = merge([final([3, 0]), final([0, 2])]);
    const m = modules(merged)["lib/app-domain/fake.ts"];
    expect(m).toMatchObject({ functions: 2, covered: 2, pct: 100, missed: [] });
    const data = merged[path.join(root, "lib/app-domain/fake.ts")];
    expect(data.s).toEqual({ "0": 3, "1": 2 });
    expect(data.b["0"]).toEqual([3, 0]);
  });

  // Ids are the converter's numbering; a location is the function itself.
  it("matches functions by where they are, not by their id", () => {
    const merged = merge([final([1, 0], "ab"), final([0, 1], "ba")]);
    const data = merged[path.join(root, "lib/app-domain/fake.ts")];
    expect(Object.keys(data.fnMap)).toHaveLength(2);
    expect(modules(merged)["lib/app-domain/fake.ts"].covered).toBe(2);
  });

  it("does not change the inputs it adds up", () => {
    const a = final([1, 0]);
    const before = JSON.stringify(a);
    merge([a, final([0, 1])]);
    expect(JSON.stringify(a)).toBe(before);
  });

  /** Three parts on disk, laid out the way the artefact download lays them out. */
  const lay = (lists: string[][], skip: number[] = []) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-cov-"));
    const found = new Map();
    const files = new Map();
    lists.forEach((list, i) => {
      const name = `coverage-${i + 1}`;
      const at = path.join(dir, `qa-report-level-3-${name}`);
      fs.mkdirSync(at, { recursive: true });
      const p = payload(name, "2026-11-01T02:07:00.000Z", 1000, [{ id: "coverage", blocking: false }]);
      const shardFile = path.join(at, `shard-${name}.json`);
      fs.writeFileSync(shardFile, JSON.stringify(p));
      found.set(name, p);
      files.set(name, shardFile);
      if (skip.includes(i + 1)) return;
      const part = partFiles([i + 1, 3]);
      fs.mkdirSync(path.join(at, part.dir));
      fs.writeFileSync(path.join(at, part.dir, "coverage-final.json"), JSON.stringify(final(i === 0 ? [1, 0] : [0, 1])));
      fs.writeFileSync(
        path.join(at, part.files),
        JSON.stringify({ testResults: list.map((f) => ({ name: path.join("/home/runner/work/x/x", f) })) }),
      );
    });
    return { found, files, out: path.join(dir, "merged") };
  };
  const thirds = (all: string[]) => [0, 1, 2].map((k) => all.filter((_, i) => i % 3 === k));
  const expected = ["main", "coverage-1", "coverage-2", "coverage-3"];

  it("judges the sum once, after proving every test file ran in exactly one part", () => {
    const { found, files, out } = lay(thirds(suiteFiles()));
    const rows = coverageRows(expected, found, files, out);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("coverage-merged");
    expect(rows[0].blocking).toBe(false);
    const titles = rows[0].findings.map((f: Finding) => f.title);
    expect(titles[0]).toMatch(/each in exactly one of 3 parts/);
    expect(titles.some((t: string) => /functions executed/.test(t))).toBe(true);
    expect(fs.existsSync(path.join(out, "coverage-final.json"))).toBe(true);
  });

  it("says so when a file ran in no part, or in two", () => {
    const [a, b, c] = thirds(suiteFiles());
    const lost = c[0];
    const { found, files, out } = lay([a, [...b, a[0]], c.slice(1)]);
    const f = coverageRows(expected, found, files, out)[0].findings[0];
    expect(f.severity).toBe("major");
    expect(f.title).toContain("1 file(s) in no part, 1 in more than one");
    expect(f.detail).toContain(`in no part: ${lost}`);
    expect(f.detail).toContain(`more than once: ${a[0]} (coverage-1, coverage-2)`);
  });

  // Two thirds of the suite would report most modules as fallen. Better
  // to say the floor was not judged than to judge it on a part.
  it("does not judge the floor when a part brought no data", () => {
    const { found, files, out } = lay(thirds(suiteFiles()), [2]);
    const rows = coverageRows(expected, found, files, out);
    expect(rows[0].findings).toHaveLength(1);
    expect(rows[0].findings[0].title).toBe("coverage was not judged: no data from coverage-2");
    expect(fs.existsSync(out)).toBe(false);
  });

  it("reports a part it cannot read, rather than losing the merged verdict", () => {
    const { found, files, out } = lay(thirds(suiteFiles()));
    const at = path.dirname(files.get("coverage-3")!);
    fs.writeFileSync(path.join(at, partFiles([3, 3]).dir, "coverage-final.json"), "{ not json");
    const rows = coverageRows(expected, found, files, out);
    expect(rows[0].findings[0].title).toBe("the coverage parts could not be merged");
    expect(rows[0].blocking).toBe(false);
  });

  it("adds nothing at a level whose coverage is not split", () => {
    expect(coverageRows(["main", "integration-1"], new Map(), new Map())).toEqual([]);
  });
});
