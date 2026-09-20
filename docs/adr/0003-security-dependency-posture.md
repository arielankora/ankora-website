# ADR 0003 — Security review: dependency posture and accepted risks

Status: accepted
Date: 2026-09-19
Context: follow-up to the OWASP Top 10 review (PR #39) and the Next.js 15 upgrade.

## Why this document exists

`npm audit` will keep reporting five advisories on this project after the
Next.js upgrade. They are not oversights. Each one was traced to the code
that actually calls the vulnerable function, and each was found to be
unreachable in this application. Without that reasoning written down, the
next person to run `npm audit` has two bad options: rerun
`npm audit fix --force` and break the build, or assume someone already
looked and move on without knowing. This file is the third option.

Re-check this list whenever a dependency moves. "Unreachable" is a claim
about today's call sites, not a permanent property.

## What the upgrade resolved

Before: 12 advisories (1 critical, 9 high).
After: 5 advisories (0 critical, 3 high).

- **next 14.2.35 → 15.5.25.** Closed all ten Next.js advisories, including
  the two criticals: GHSA-2xp9-vwfh-vxw4 (unauthenticated RCE in the Image
  Optimization API via AVIF) and GHSA-p293-qw3h-jr36 (RCE on Windows
  hosts). React stays on 18.3.1 — 15.5.25 still supports `^18.2.0`, so the
  React 19 migration was not required and was deliberately not bundled in.
- **postcss 8.4.x → 8.5.28**, forced into Next's own copy via an
  `overrides` entry. Closed the sourceMappingURL arbitrary-file-read
  advisories.
- **js-yaml 3.15.1 → 3.15.2** inside `gray-matter`, via `overrides`.
- **pdfjs-dist 3.11.174 → 6.3.289** (devDependency). This removed the
  optional `canvas` dependency and with it the `tar` critical and the
  `@mapbox/node-pre-gyp` high. Required one import-path change in
  `tests/unit/pdf.test.ts` (`legacy/build/pdf.js` → `.mjs`); all seven
  assertions in that file still pass.

## Accepted: exceljs → uuid (moderate)

Advisory: "uuid: Missing buffer bounds check in v3/v5/v6 when `buf` is
provided." Fix would require uuid >= 11.1.1, which means exceljs 3.4.0 —
a major *downgrade* of exceljs that would lose the multi-sheet workbook
API `lib/xlsx.ts` depends on.

Not reachable here. The advisory is specific to the v3, v5 and v6
generators *and* to passing a `buf` argument. exceljs imports exactly one
symbol and calls it with no arguments:

    // node_modules/exceljs/lib/xlsx/xform/sheet/cf-ext/cf-rule-ext-xform.js
    const {v4: uuidv4} = require('uuid');
    model.x14Id = `{${uuidv4()}}`.toUpperCase();

v4 is not in the affected set and no buffer is supplied. There is no code
path from our exports to the vulnerable branch.

Revisit if exceljs publishes a release that takes uuid >= 11, or if we
ever call uuid directly.

## Accepted: prisma → @prisma/config → deepmerge-ts (high)

Advisory: "DeepmergeTS has stack exhaustion when merging recursive object
graphs." Fixed in deepmerge-ts 8; `@prisma/config` 6.19.3 (the latest 6.x)
still pins 7.1.5. npm's suggested remediation is prisma 6.12.0 — an older
release than the one we run, so "fixing" it would move us backwards.

Not reachable here. `@prisma/config` is the Prisma **CLI's** configuration
loader. It runs at build time, merging our own `prisma/schema.prisma` and
config, and never processes runtime input. Reaching the stack-exhaustion
path requires feeding it a recursive object graph, which means already
controlling the repository — at which point the attacker has better
options than crashing a build.

Forcing `deepmerge-ts@^8` through `overrides` was considered and rejected:
`@prisma/config` is compiled against the 7.x API, and a silently mismatched
merge implementation inside the tool that generates our database client is
a worse failure mode than a build-time DoS we cannot trigger.

Revisit when Prisma ships a release depending on deepmerge-ts >= 8.

## Standing rule

Do not run `npm audit fix --force` on this project. Every remaining
advisory's "fix" is a major downgrade of a package we depend on. New
advisories should be traced to a call site the way the two above were,
and either fixed properly or documented here.

<!-- neon cleanup workflow verification: safe to delete -->
