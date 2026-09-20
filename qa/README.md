# QA — the Ankora regression agent

Three levels of proof that the site and the product still work, plus the
mechanism that keeps those checks honest as the product grows.

```bash
npm run qa          # level 2 — the default
npm run qa:1        # quick regression     ~4 min
npm run qa:2        # deep regression      ~20 min
npm run qa:3        # deep fault hunt      ~60 min
npm run qa:scan     # what can this product do, and what is untested?
npm run qa:sync     # record newly discovered capabilities in the manifest
```

Levels are **cumulative**: level 3 is level 2 plus more, so a finding never
depends on which level happened to run. The only thing a level changes is
how much of the product gets looked at.

| | Level 1 · quick | Level 2 · deep | Level 3 · fault hunt |
|---|---|---|---|
| **Question** | did we break the build? | did we break the product? | what is broken that nobody has noticed? |
| **When** | every pull request | every night, and before a release | before a big release, after an incident, on demand |
| **Capability drift** | ✓ | ✓ | ✓ |
| Type check, lint, unit tests | ✓ | ✓ | ✓ |
| Live production probe | ✓ | ✓ | ✓ |
| Integration tests, production build | | ✓ | ✓ |
| Browser end-to-end, dependency advisories | | ✓ | ✓ |
| Permission matrix, boundary & data integrity | | | ✓ |
| Accessibility, RTL, performance budgets | | | ✓ |

## The three ideas this suite is built on

**1. Coverage is computed, never declared.**
A hand-written list of "what is tested" is a second inventory to maintain,
and it rots exactly like the first one. `qa/lib/discover.mjs` reads the
product's own source — every page, screen, API route, Server Action, MCP
tool and cron — and asks the test files whether anything touches it. Ship a
new feature and it appears in the next scan as an uncovered capability,
without anyone remembering to add it anywhere.

This proves a test *touches* a capability, not that it tests it well. It is
a floor, not a ceiling. It catches "nobody has looked at this at all",
which is the failure mode that actually bites after a feature ships.

**2. A baseline, so red means red.**
This repo carries three long-standing failing tests. A suite in that state
trains its owner to skim past red, and the fourth failure — the real one —
sails through. `qa/baseline.json` names each accepted failure with a reason
and the date it was accepted. Those report as `info` with their age; *any*
failure not on that list is a blocker. Waivers that stop matching are
reported too, because a baseline nobody prunes becomes a blindfold.

**3. The environment is judged before the product is.**
During this suite's own bring-up, `tsc` went red — not because a type
broke, but because `prisma generate` could not reach its binary host
through an egress policy. The first version of the production probe
reported an egress proxy's blanket 403 as eleven production outages. Both
are now preflight checks: anything the environment cannot do becomes an
explicit SKIP with a stated reason, never a FAIL. A gate that cries wolf is
a gate people route around.

## Risk tiers

The manifest assigns each capability a risk tier, and the tier decides how
much proof it owes — not whether it is tested at all.

| Tier | Owes | Typical |
|---|---|---|
| `critical` | a logic test **and** an end-to-end test | auth, money, data integrity, crons, MCP writes |
| `high` | a logic test | product screens, API routes, domain modules |
| `medium` | any test | marketing pages |
| `low` | — | cosmetic surfaces |

New capabilities get a *guessed* tier so nothing sits unclassified, with
`riskAssigned: false` until a human or the agent confirms it. The manifest
value always wins over the guess.

## Where each thing runs

`ankora.co.il` and `binaries.prisma.sh` are unreachable from the
assistant's sandbox and from the device bridge under the current egress
policy. GitHub's runners have neither restriction. So:

- **Locally / from the assistant:** capability scan, lint, and whatever
  else the preflight finds possible. Everything else skips, loudly.
- **In CI (`.github/workflows/qa.yml`):** the whole suite, for real —
  level 1 blocking on every pull request, level 2 nightly against `main`,
  any level on manual dispatch.

Reports land in `qa/reports/` (git-ignored) as `last.json` for machines and
`last.md` for the pull-request comment.

## Adding a check

Write a function that returns an array of `finding(severity, title, detail)`
and register it in `qa/run.mjs` with the level it belongs to. Use
`skipIf` with one of the `needs.*` guards when it depends on something the
environment might not have. Severity `blocker` fails the run; `major` and
below are reported and do not.
