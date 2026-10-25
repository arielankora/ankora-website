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

## Fixed, not accepted: the MCP input-size pair (25.10.2026)

Two advisories a week apart, both reachable, both closed by a patch bump
plus one line of configuration. Written down because the configuration is
the part that is easy to lose.

- **`@modelcontextprotocol/server` 2.0.0 → 2.4.0.** GHSA-46jr-4wx8-v453 /
  CVE-2026-111768: the SDK put no ceiling on how many array elements and
  object members it would validate inside one `tools/call`, so a single
  request under the body-size limit could end the function in "JavaScript
  heap out of memory". Fixed in 2.3.0.
- **`zod` 4.6.5 → 4.6.7.** GHSA-mrhx-c7xc-m3w5: `$ZodArray` collected one
  issue per failing element, with no cap and no early exit, on any array
  schema without a length constraint. Fixed in 4.6.6.
- **`mcp-handler` 2.2.0 → 2.3.0**, which is the release that refuses a
  shared server instance. We were never exposed to the advisory that
  change is for (see below), but staying on a version whose peer is a
  withdrawn SDK line is not worth the saving.

Reachable, and the reasoning matters because the first reading says
otherwise. Both endpoints authenticate before the SDK sees the body
(`withMcpAuth(..., { required: true })`), so this was never anonymous. It
was still worth fixing at once: `/api/mcp/portal` is reachable by a
client's portal user and not only by staff, the per-token rate limit of
120 a minute is irrelevant to an attack that needs one request, and
`propose_knowledge` took `participants`, `alsoSources` and a `z.record`
payload with no bound at all.

**The upgrade alone fixes nothing.** `maxToolInputElements` ships off by
default. `lib/mcp/limits.ts` turns it on for both handlers, and has to
pass it through a cast: mcp-handler 2.3.0 types its options as the SDK's
`ServerOptions`, which does not declare the field, while at runtime it
collects unrecognised options with a rest spread and hands them to
`new McpServer`. `tests/unit/mcp/input-limit.test.ts` asserts the running
server refuses an oversized payload, because a cast cannot be trusted to
keep working and a rename upstream would otherwise be silent. Remove the
cast when mcp-handler widens the type.

The schemas were bounded as well, in `lib/mcp/client-file-tools.ts`. A
dependency fix that a future version can regress is not the place to
leave the only defence, and the bounds are right on their own terms: a
meeting has a dozen participants, not fifty.

`maxRequestBodySize`, which the advisory also recommends, is **not**
reachable from here: mcp-handler forwards only `legacy`, `onerror` and
`maxSubscriptions` to the SDK's own handler options. Vercel's 4.5MB
function body limit is what caps the request itself today.

## Checked and not applicable: the other two MCP SDK advisories

Recorded so the weekly check does not re-derive them.

- **GHSA-jm63-cq47-j5jp** (one client's responses delivered to another).
  Requires a `McpServer` or transport built once and shared across
  requests. mcp-handler passes `createMcpHandler` a factory that builds a
  new `McpServer` per call, which the advisory names explicitly as the
  unaffected pattern.
- **GHSA-rvq5-wwqv-78pq** (bearer tokens issued for another service
  accepted). Concerns the SDK's own bearer verification. `withMcpAuth`
  calls `verifyMcpBearerToken` in `lib/mcp/auth.ts`, which resolves a
  token by prefix and hash against our own tables and trusts no external
  issuer.

## Accepted: @vercel/oidc → @vercel/cli-config → zod 4.1.11 (high)

Survives the zod bump above, because this is a second, nested copy. npm's
suggested remediation is `@vercel/oidc` 3.5.0, a major downgrade, which is
the pattern the standing rule below forbids.

Not reachable here. `@vercel/cli-config` reads the Vercel CLI's own local
configuration files, never network input, and `@vercel/oidc` is used only
by `getVercelOidcToken` in `lib/google-drive.ts` and
`lib/vault/gcp-token.ts`. Nothing an attacker controls is parsed by that
copy of zod.

## Accepted: vite, vitest and @vitest/mocker (high and moderate)

All three are `dev: true` in the lockfile and run only under
`npm test`. They never enter a deployed bundle, and the inputs they parse
are this repository's own test files.

## Standing rule

Do not run `npm audit fix --force` on this project. Every remaining
advisory's "fix" is a major downgrade of a package we depend on. New
advisories should be traced to a call site the way the two above were,
and either fixed properly or documented here.
