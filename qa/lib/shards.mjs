// Which checks run where, when a level-3 run is split across parallel jobs.
//
// Why this exists, and it is arithmetic rather than taste. Level 3 is
// level 2 plus three more passes, and the three heavy ones are
// independent of each other but ran serially in one job against one
// database:
//
//   integration (Israel)                1266.7s   run #399, 17.10.2026
//   integration-utc, whole suite        ~1020s    (level 2 runs 12 files
//                                                  of it in 244.9s)
//   coverage: unit + integration, V8    >=1300s
//   e2e 257.3s · build 54.0s · level-1 checks ~2 min · a11y
//
// That is ~73 minutes of checks in a row. It overran the job's 45-minute
// wall on 11.10 and again on 18.10, and both runs were labelled
// "cancelled" - which reads as a person having stopped them, so two
// Sundays passed with no verdict and nobody noticed. The wall went to 90
// in #246, which bought room but did not change the shape: the daily
// level-2 run has gone from 11 minutes in late September to 34, so the
// suite walks toward any wall put in front of it.
//
// Splitting is the structural fix the journal has recommended twice. The
// three heavy passes get a job each, everything else shares one:
//
//   integration   ~21 min      utc        ~17 min
//   coverage      ~22 min      main       ~11 min   (level 1 + build +
//                                                    e2e + a11y)
//
// Wall clock becomes the longest shard rather than the sum: ~25 minutes
// instead of ~73. The cost is honest - four checkouts, four `npm ci`s and
// four Postgres containers instead of one - and it is paid once a week.
//
// Levels 1 and 2 are NOT sharded. Level 2 is 34 minutes and dominated by
// the single `integration` check, so splitting it would triple the
// per-job setup to move one number that is already on the critical path.
// Splitting `integration` itself is the next question, and a different
// one.
//
// The map is by check id, not by level, so a check that moves between
// levels does not silently change shard.

/** Checks that get a job to themselves. Everything else runs in `main`. */
export const SHARD_CHECKS = {
  integration: ["integration"],
  utc: ["integration-utc"],
  coverage: ["coverage"],
};

export const MAIN_SHARD = "main";

/** Every shard name, `main` first. The workflow's matrix reads this order. */
export const SHARDS = [MAIN_SHARD, ...Object.keys(SHARD_CHECKS)];

/**
 * Checks every shard runs, whatever else it owns.
 *
 * `preflight` is not really a check. It is what fills `capabilities` in
 * checks/preflight.mjs, and every `skipIf` in the runner consults that
 * object. A shard that does not run it sees a machine with no database, no
 * browser and no Prisma client, skips everything it owns, and finishes
 * green in under a second.
 *
 * Measured, not feared: the first sharded run (#508, 20.10.2026) had
 * `utc`, `integration` and `coverage` all report success with "Run QA" at
 * 0 seconds. Three quarters of the weekly hunt did not happen and nothing
 * was red. This is the suite's oldest failure mode and the split walked
 * straight back into it.
 *
 * The merge de-duplicates the rows these produce, keeping the worst.
 */
export const ALWAYS = ["preflight"];

const OWNER = new Map(
  Object.entries(SHARD_CHECKS).flatMap(([shard, ids]) => ids.map((id) => [id, shard])),
);

/** The shard a check belongs to. Unclaimed ids belong to `main`. */
export function shardOf(id) {
  return OWNER.get(id) ?? MAIN_SHARD;
}

/**
 * Should this check run in this shard?
 *
 * A null/empty shard means "not sharded" - one job runs everything, which
 * is what levels 1 and 2 and every local run do.
 */
export function inShard(id, shard) {
  if (!shard) return true;
  if (ALWAYS.includes(id)) return true;
  return shardOf(id) === shard;
}

export function isShard(name) {
  return SHARDS.includes(name);
}

/** Every check id this file claims, so a static check can verify they exist. */
export function claimedCheckIds() {
  return Object.values(SHARD_CHECKS).flat();
}
