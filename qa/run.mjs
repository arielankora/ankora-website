#!/usr/bin/env node
// The QA runner.
//
//   npm run qa          # level 2 - the default, deep regression
//   npm run qa:1        # quick regression   (~4 min)   - static + unit + prod probe
//   npm run qa:2        # deep regression    (~20 min)  - + integration, build, e2e, deps
//   npm run qa:3        # deep fault hunt    (~60 min)  - + adversarial, boundary, a11y, perf
//
// Levels are cumulative by design: level 3 is level 2 plus more, so a
// finding never depends on which level you happened to run. The only
// thing a level changes is how much of the product gets looked at.
//
// What blocks: a check marked `blocking` that fails. Coverage drift and
// dependency advisories never block - they are work items, not outages,
// and a gate that cries wolf is a gate people route around.

import { Run } from "./lib/report.mjs";
import { sh } from "./lib/sh.mjs";
import * as staticChecks from "./checks/static.mjs";
import * as vitest from "./checks/vitest.mjs";
import * as production from "./checks/production.mjs";
import { preflight, needs } from "./checks/preflight.mjs";
import { finding } from "./lib/report.mjs";

const LEVELS = {
  1: "quick regression",
  2: "deep regression",
  3: "deep fault hunt",
};

function parseLevel() {
  const arg = process.argv.slice(2).find((a) => /^--?level(=|$)|^[123]$/.test(a));
  if (!arg) return Number(process.env.QA_LEVEL ?? 2);
  const m = arg.match(/(\d)/);
  return m ? Number(m[1]) : 2;
}

async function main() {
  const level = parseLevel();
  if (!LEVELS[level]) {
    process.stderr.write(`Unknown level "${level}". Use 1, 2 or 3.\n`);
    process.exit(2);
  }

  process.stdout.write(`\n  ANKORA QA — level ${level}: ${LEVELS[level]}\n`);
  process.stdout.write(`  ${new Date().toISOString().replace("T", " ").slice(0, 16)}\n\n`);

  const run = new Run(level);

  // Establish what this environment can actually do before judging the
  // product by it. See checks/preflight.mjs for why this is not optional.
  await run.check("preflight", { label: "Environment preflight", level: 1, blocking: false }, preflight);

  // ── Level 1 ───────────────────────────────────────────────────────────
  // Drift runs first and at every level: knowing the product grew is
  // worth more than any single assertion, and it costs a second.
  await run.check("drift", { label: "Capability drift", level: 1, blocking: false }, async () => {
    const r = await sh("node", ["qa/scan.mjs", "--json"], { timeoutMs: 60_000 });
    const data = JSON.parse(r.out);
    const out = [];
    if (data.added.length)
      out.push(finding("major", `${data.added.length} new capability/ies with no manifest entry`, data.added.slice(0, 20).join("\n")));
    if (data.removed.length)
      out.push(finding("minor", `${data.removed.length} capability/ies disappeared from source`, data.removed.join("\n")));
    const criticalGaps = data.gaps.filter((g) => g.risk === "critical");
    if (criticalGaps.length)
      out.push(
        finding("major", `${criticalGaps.length} critical capability/ies below their required coverage`,
          criticalGaps.slice(0, 20).map((g) => `${g.id} → missing ${g.missing.join(", ")}`).join("\n")),
      );
    out.push(finding("info", `${data.total} capabilities tracked`));
    return out;
  });

  await run.check("types", { label: "TypeScript", level: 1, skipIf: needs.prisma }, staticChecks.types);
  await run.check("lint", { label: "Lint", level: 1, blocking: false }, staticChecks.lint);
  await run.check("unit", { label: "Unit tests", level: 1, skipIf: needs.prisma }, vitest.unit);
  await run.check(
    "production",
    { label: "Production probe", level: 1, skipIf: production.skipIfUnreachable },
    production.probe,
  );

  // ── Level 2 ───────────────────────────────────────────────────────────
  // Everything below needs either a database, a build, or a browser -
  // which is exactly why it is not in the fast lane.
  await run.check("integration", { label: "Integration tests", level: 2, skipIf: needs.database }, vitest.integration);
  await run.check("build", { label: "Production build", level: 2, skipIf: needs.prisma }, async () => {
    const r = await sh("npx", ["next", "build"], { timeoutMs: 20 * 60_000, env: { SKIP_ENV_VALIDATION: "1" } });
    if (r.code === 0) return [];
    return [finding("blocker", "next build failed", r.all.split("\n").slice(-30).join("\n"))];
  });

  // e2e / deps / a11y / perf land in the next stage; the runner already
  // reserves their slots so adding them is a one-line change here.
  for (const [id, label, lvl] of [
    ["e2e", "Browser end-to-end", 2],
    ["deps", "Dependency advisories", 2],
    ["rbac", "Permission matrix", 3],
    ["boundary", "Boundary & data integrity", 3],
    ["a11y", "Accessibility & RTL", 3],
    ["perf", "Performance budgets", 3],
  ]) {
    await run.check(id, { label, level: lvl, blocking: false, skipIf: async () => "not implemented yet (stage 2)" }, async () => []);
  }

  run.print();
  const file = run.persist();
  process.stdout.write(`  Report: ${file}\n\n`);
  process.exit(run.failed ? 1 : 0);
}

main();
