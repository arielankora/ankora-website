// Which checks run where, when a run is split across parallel jobs.
//
// Why this exists, and it is arithmetic rather than taste. The three heavy
// passes are independent of each other but ran serially in one job against
// one database. Measured on run #514 (20.10.2026, level 3):
//
//   integration (Israel)                1319.8s = 22.0 min
//   integration-utc, whole suite        1104.0s = 18.4 min
//   coverage: unit + integration, V8     ~26 min
//   e2e 291.7s · build 56.4s · level 1 ~2 min · a11y 69.6s
//
// About 78 minutes of checks in a row. It overran the job's 45-minute wall
// on 11.10 and again on 18.10, and both runs were labelled "cancelled",
// which reads as a person having stopped them, so two Sundays passed with
// no verdict. #246 raised the wall to 90; the measurement above shows that
// would not have been enough either.
//
// Splitting makes the clock the longest shard rather than the sum.
//
// 20.10.2026, second pass: `integration` is now split further, with vitest's
// own `--shard`. The reason is level 2, not level 3.
//
//   Level 3's critical path is `coverage` at ~29 minutes. Splitting
//   integration there saves nothing on the clock; it only buys headroom for
//   later. Level 2 is the one that pays: it runs every night and gates most
//   pull requests, it has grown from 11 minutes in late September to 34, and
//   `integration` is almost all of it. Three ways takes level 2 from about
//   34 minutes to about 15.
//
// Splitting integration ACROSS JOBS rather than inside one is the only way
// it works: the suite runs `--no-file-parallelism` because its files share a
// database and truncate between tests. A shard with its own Postgres
// container has no one to collide with.
//
// Level 1 is never split. It is two minutes, and four job setups to save one
// would be a worse gate, not a faster one.

/**
 * Shards that own specific checks, and how a check is divided inside one.
 *
 * `split: [k, n]` is passed to vitest as `--shard=k/n`. A check with no
 * split runs whole in its shard. Everything unclaimed runs in `main`.
 */
export const SHARD_CHECKS = {
  "integration-1": { checks: ["integration"], split: [1, 3] },
  "integration-2": { checks: ["integration"], split: [2, 3] },
  "integration-3": { checks: ["integration"], split: [3, 3] },
  utc: { checks: ["integration-utc"] },
  coverage: { checks: ["coverage"] },
};

export const MAIN_SHARD = "main";

/**
 * Which shards each level runs as parallel jobs. `null` means one job.
 *
 * A check whose owning shard is not in this level's list falls back to
 * `main`, so level 2 still runs `integration-utc` (its twelve date-sensitive
 * files, about four minutes) without paying a job setup for it.
 */
export const PLAN = {
  1: null,
  2: [MAIN_SHARD, "integration-1", "integration-2", "integration-3"],
  3: [MAIN_SHARD, "integration-1", "integration-2", "integration-3", "utc", "coverage"],
};

/** The shard names for a level, or null when that level runs as one job. */
export function shardsFor(level) {
  return PLAN[level] ?? null;
}

/**
 * Checks every shard runs, whatever else it owns.
 *
 * `preflight` is not really a check. It is what fills `capabilities` in
 * checks/preflight.mjs, and every `skipIf` in the runner consults that
 * object. A shard that does not run it sees a machine with no database, no
 * browser and no Prisma client, skips everything it owns, and finishes green
 * in under a second.
 *
 * Measured, not feared: the first sharded run (#508, 20.10.2026) had `utc`,
 * `integration` and `coverage` all report success with "Run QA" at 0 seconds.
 * Three quarters of the weekly hunt did not happen and nothing was red.
 */
export const ALWAYS = ["preflight"];

/**
 * id -> every shard that claims it.
 *
 * A set, not a single owner, and that distinction is the whole point of the
 * second pass: `integration` is claimed by three shards at once. An earlier
 * draft of this file keyed one shard per id, so the map kept whichever came
 * last and `integration-1` and `integration-2` owned nothing. They would
 * have started, run preflight, found nothing of their own to do and exited.
 * The guard in qa/run.mjs would have caught it on the first CI run; the map
 * should not need the guard.
 */
const OWNERS = new Map();
for (const [shard, spec] of Object.entries(SHARD_CHECKS)) {
  for (const id of spec.checks) {
    if (!OWNERS.has(id)) OWNERS.set(id, []);
    OWNERS.get(id).push(shard);
  }
}

/** The shards that run a check at this level. Empty means it falls to main. */
function activeOwners(id, level) {
  const owners = OWNERS.get(id);
  if (!owners) return [];
  const plan = shardsFor(level);
  return plan ? owners.filter((o) => plan.includes(o)) : owners;
}

/**
 * The first shard that runs this check at this level, for messages only.
 *
 * Unclaimed ids, and ids whose owners this level does not run, belong to
 * `main`. A check must land somewhere: one that falls out of the plan is a
 * check that silently stops running, which is the failure this file exists
 * to prevent.
 */
export function shardOf(id, level = 3) {
  return activeOwners(id, level)[0] ?? MAIN_SHARD;
}

/**
 * Should this check run in this shard?
 *
 * A null/empty shard means "not sharded": one job runs everything, which is
 * what level 1 and every local run do.
 */
export function inShard(id, shard, level = 3) {
  if (!shard) return true;
  if (ALWAYS.includes(id)) return true;
  const active = activeOwners(id, level);
  if (active.length === 0) return shard === MAIN_SHARD;
  return active.includes(shard);
}

/** `[k, n]` for `--shard=k/n`, or null when this shard runs its check whole. */
export function splitFor(shard) {
  return SHARD_CHECKS[shard]?.split ?? null;
}

/** The checks a shard is responsible for, for the merge to verify against. */
export function checksOwnedBy(shard) {
  return SHARD_CHECKS[shard]?.checks ?? [];
}

export function isShard(name) {
  return name === MAIN_SHARD || Object.hasOwn(SHARD_CHECKS, name);
}

/** Every check id this file claims, so a static check can verify they exist. */
export function claimedCheckIds() {
  return [...new Set(Object.values(SHARD_CHECKS).flatMap((s) => s.checks))];
}
