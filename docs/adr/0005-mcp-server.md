# ADR 0005 — MCP server: letting Ankora employees reach the app through Claude

Status: accepted (Phases 1–3 built)
Date: 2026-09-20
Context: Ariel asked for two-way communication between the Ankora app and
Claude. This document records the scope that was chosen, the two findings
that shaped it, and what is deliberately left for later.

## Scope

Ankora **employees** read and write their own Time Tracking data through
Claude, and managers read the team's. Client-facing access (a `CLIENT_USER` reaching the Client
Portal through Claude) is out of scope here and is discussed only in
"What comes after", because one decision below is load-bearing for it.

"Two-way" needs unpacking, because it is two different systems:

* **Claude → Ankora.** Claude reads and acts on Ankora data. This is what
  MCP is for, and it is what this ADR covers.
* **Ankora → Claude.** The app initiates a request to Claude (a button, a
  nightly job). That is not MCP — it is the Agent SDK or the Messages API
  called from our own code. It is not built and not scheduled, but the
  same server built here serves it when it is, which is why this ADR does
  not put the tools anywhere Claude-specific.

## Finding 1 — the domain layer is already the right seam

`lib/app-domain/*` is twenty modules whose functions take `actor: User`
first and immediately call `assertCan(actor.role, …)` or
`listAccessibleClients(actor)`. The Server Actions above them
(`app/(product)/app/**/actions.ts`) hold no business logic at all: they
call `requireUser()`, forward to a domain function, `revalidatePath`, and
translate the thrown error into Hebrew for the screen.

So the MCP tools call `lib/app-domain/*` directly, and inherit the RBAC in
`lib/app-auth/permissions.ts`, the `UserClientAccess` scoping, the
`AuditEvent` trail and the billing policy with no second implementation to
keep in step. **No Prisma query lives in `lib/mcp/`.** A permission fix in
the domain layer fixes the MCP surface at the same moment.

This is also why the server lives inside this Next.js app rather than in a
service of its own: `lib/app-domain/*` is `server-only` and imports Prisma
directly, so a separate service would have to either duplicate that layer
or grow a REST API in front of it first. Neither is worth doing to move
code one process to the left.

The Server Actions themselves are **not** reusable here — they are
`"use server"` functions reachable only from this app's own React tree,
and they carry `revalidatePath` calls that mean nothing to an MCP client.
Nothing about that is a problem; the layer underneath them is the target.

## Finding 2 — a shared credential would erase the RBAC model

Claude's hosted surfaces (claude.ai, Desktop connectors, mobile, Cowork)
authenticate a custom remote MCP server with OAuth. There is a beta
"static header" option that accepts a fixed bearer token, and it looks
like the cheap way in.

It is not usable here. That credential is entered once by an organisation
administrator and is **shared by the whole organisation** — every employee
would reach the server as the same anonymous identity. `assertCan` would
have one role to check, `listAccessibleClients` would return one person's
clients to everybody, and every `AuditEvent` would name the same actor.
For a read-only toy that is merely bad; for a server that writes time
entries it is disqualifying.

Per-user identity on those surfaces therefore requires OAuth, and Auth.js
v5 is an OAuth *client*, not an authorization server — so we would have to
build or buy one (DCR or CIMD, S256 PKCE, form-encoded `/token`, refresh
rotation). That is real work and it is not the first thing worth doing.

**So Phase 1 does not use those surfaces at all.** Claude Desktop also
runs local stdio MCP servers, which have no such constraint: a local
process holds *one person's* token, so the server sees one person.
`scripts/mcp-bridge.mjs` is that process — it forwards JSON-RPC from
Claude Desktop to `/api/mcp` with a personal access token attached.

The endpoint is the same one OAuth will protect later. `withMcpAuth`
already emits the RFC 9728 `401` challenge that flow needs, so Phase 2
adds an authorization server and deletes the bridge; it does not rewrite
the server.

## What Phase 1 built

| Piece | File |
| --- | --- |
| Token model + migration | `prisma/schema.prisma`, `prisma/migrations/20260920160000_phase13_mcp_access_tokens/` |
| Token format (pure) | `lib/mcp/token.ts` |
| Token → `User` resolution | `lib/mcp/auth.ts` |
| Model-facing error mapping (pure) | `lib/mcp/errors.ts` |
| Name → id resolution (pure) | `lib/mcp/resolve.ts` |
| Output shaping (pure) | `lib/mcp/serialize.ts` |
| The three read tools | `lib/mcp/tools.ts` |
| The endpoint | `app/api/mcp/route.ts` |
| Token issuing CLI | `scripts/mcp-issue-token.ts` |
| Claude Desktop bridge | `scripts/mcp-bridge.mjs` |

Tools: `list_my_clients`, `get_active_timer`, `list_my_time_entries`.

Three read tools is not timidity, it is the point. This slice exercises
the whole chain — token → `User` → `assertCan`/`listAccessibleClients` →
domain → serialised output — on the smallest surface that can prove it
works. Everything after it is repetition of a proven shape.

### Decisions worth not re-litigating

**MCP tokens honour `User.tokenVersion`.** Spec 4.2's "logout all
sessions" works by bumping that counter. If MCP tokens ignored it, an
admin revoking a departing employee's sessions would lock them out of the
browser while their Claude Desktop kept full access. `McpAccessToken`
snapshots the counter at issue time and `resolveMcpActor` compares it, so
one action revokes both.

**Tokens are looked up by hash, not compared.** `lib/cron-auth.ts` uses
`timingSafeEqual`, correctly, because it compares one presented string
against one known secret. Here the presented token is hashed and used as
an indexed lookup key: a wrong token finds no row, and there is no
per-byte comparison to time. The two are different problems.

**SHA-256, not bcrypt.** `lib/app-auth/password.ts` uses a slow KDF
because a password is low-entropy and human-chosen. This token is 256 bits
of CSPRNG output — brute force is not on the table, and the hash runs on
every request.

**Errors are written for the model, not the screen.** The Hebrew strings
in `friendlyError()` are right for a human who can see the surrounding UI
and wrong for a model deciding what to call next. `lib/mcp/errors.ts` maps
by `err.name` rather than `instanceof`, which is what keeps it free of
`server-only` and unit-testable, and answers with a next step
("call `get_active_timer`, then `stop_timer`"). Unrecognised errors get a
deliberately vague message: an unexpected Prisma throw can carry a table
name or a row fragment, and tool output goes straight to a model.

**No tool takes a raw id as its only handle.** Every domain function wants
cuids and a model does not have them; given a required id argument it will
eventually invent one, and in a write tool that means time booked against
the wrong client — silent, plausible, and unnoticed for a month.
`lib/mcp/resolve.ts` resolves names against the rows *that actor* may see
and refuses to guess when the answer is not unique. Phase 1 has no write
tools, but the module exists and is tested now because Phase 2's first
tool needs it on day one.

**Rate limiting is keyed on the token hash.** Keying on IP would put a
whole office behind one bucket. Requests without a well-formed token fall
back to the IP bucket, which throttles a scanner before it reaches
Postgres.

### Verification

`tests/unit/mcp/` covers all five modules — the four pure ones and
`auth.ts` — in 81 assertions.

`auth.ts` was initially assumed to need a database and shipped unverified.
It does not: its only runtime import from the app is `prisma` itself
(`@prisma/client` and `@modelcontextprotocol/server` are both
`import type`, and `server-only` is already aliased in
`vitest.config.ts`), so mocking `@/lib/prisma` reaches every branch
without Postgres and without the Prisma engine this sandbox cannot
download. Each of the four `getCurrentUser` checks — `revokedAt`,
`expiresAt`, `deletedAt`/`status`, `tokenVersion` — has a test that fails
when that check is deleted, confirmed by mutation rather than assumed.

Still not covered by any test: the Prisma query itself. A typo in the
`include` or a schema drift would pass these tests and fail in
production. The Vercel Preview build catches the schema half of that
(`npm run build` runs `prisma generate && prisma migrate deploy`, so the
migration is applied to a real Neon branch and the code is typechecked
against the generated client), which leaves a genuine first run against a
database as the remaining step — see the README.

The migration is hand-authored for the same reason as every prior phase's
— see that file's header.

## What comes after

**Phase 2 — writes and team visibility. Built.**

Four write tools (`start_timer`, `stop_timer`, `update_timer_note`,
`create_time_entry`) and two admin-only read tools (`list_team_members`,
`list_team_time_entries`). Ten tools in all.

The three prerequisites this ADR set for writes were met before the first
one shipped:

1. **`createdVia` on `TimeEntry`** — a new `EntryOrigin` enum (`APP` |
   `MCP`), defaulted so the migration labels every existing row correctly.
   Deliberately separate from `TimeEntrySource`, which records *how* an
   entry was made (timer vs typed form) rather than *where from*; a timer
   Claude starts is `TIMER` + `MCP`. `AuditEvent` already records who
   acted, but not through what.
2. **Name resolution on every write** (`lib/mcp/lookup.ts` over
   `lib/mcp/resolve.ts`), always against what that actor may see.
3. **The read/write split pinned by test.** `lib/mcp/annotations.ts` is a
   pure module holding every tool's annotations, and
   `tests/unit/mcp/annotations.test.ts` fails if a write tool is ever
   marked `readOnlyHint: true` — the hint that tells a client it is safe
   to call without asking a human.

### Team visibility reuses an existing rule rather than inventing one

"What did Hadas do last week" needs one decision: who may read another
person's time. That question was already answered twice in this codebase —
`app/(product)/app/(authenticated)/time-entries/page.tsx` gates its screen
on `time_entry.edit_others`, and `app/api/time-entries/export/route.ts`
gates the same data on the same permission. The MCP tools use it too, so
there is one answer and not three. In practice: SUPER_ADMIN and
ANKORA_ADMIN yes, ANKORA_EMPLOYEE and CLIENT_USER no.

`listTimeEntriesForAdmin` carries no permission check of its own, and the
export route has a comment saying so deliberately — the caller gates it.
The MCP tool follows that established convention rather than changing a
shared signature, and asserts the same permission at the tool boundary.
`lib/mcp/lookup.ts` asserts it a second time inside the team lookups,
because listing colleagues is a disclosure in its own right and should not
be reachable through a mistake in one tool's gating.

### Two things Phase 2 deliberately did not do

**No `delete_time_entry`.** Deletion stays in the UI, where a human can
see what is about to disappear. Every annotation in this surface carries
`destructiveHint: false`, and a test asserts it.

**No writing on behalf of someone else.** `createManualEntry` supports it
(`assertCan(... "time_entry.edit_others")` when the target is not the
actor), and the MCP tool passes `actor.id` unconditionally. An admin
correcting an employee's timesheet does it on the screen, where the
audit trail has a human looking at what changed.

**Phase 3 — OAuth. Built.**

Ankora is now its own OAuth 2.1 authorization server, so Claude connects
by URL and the person signs in with their Ankora account. No bridge, no
Node install, no token to copy — which is what makes a third and fourth
employee possible at all. The stdio bridge and its personal access tokens
keep working side by side; `resolveMcpActor` tells the two credential
kinds apart by prefix and runs the identical four checks on each.

Auth.js could not do this. It is an OAuth *client* — it knows how to send
you to sign in somewhere else. What was needed is the opposite: the thing
Claude is sent to. An external IdP was considered and rejected, because
identity already lives here (the `users` table, bcrypt, `tokenVersion`),
and adopting one would mean either migrating every user or running two
systems that each believe they are the source of truth.

| Piece | Path |
| --- | --- |
| Discovery (RFC 8414 / RFC 9728) | `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource` |
| Dynamic client registration (RFC 7591) | `/api/mcp/oauth/register` |
| Authorization + consent | `/api/mcp/oauth/authorize` → `/app/oauth/consent` → `/api/mcp/oauth/consent` |
| Token exchange and refresh | `/api/mcp/oauth/token` |

### Decisions worth not re-litigating

**PKCE S256 only.** `plain` is refused outright. Accepting it would let
whoever intercepted an authorization code also satisfy the challenge,
which is the entire threat PKCE exists for, and a downgrade attack gets it
by simply asking.

**Only https and loopback http may be registered as redirect URIs.** A
first cut accepted any `scheme://host`; a unit test immediately showed
that also accepts `data://text/html,x`. The fix was not a better filter —
it was deleting the branch. The shape of a scheme is a bad proxy for
whether it is safe to hand an authorization code to.

**No redirect before the redirect URI is validated.** RFC 6749 section
4.1.2.1, and the reason is the open-redirect class: an error delivered to
an unvalidated URI is the primitive an attacker wants. Both the authorize
endpoint and the consent handler render a plain error page instead.

**Refresh tokens rotate, and reuse revokes the grant.** Rotation writes a
new row and points the old one at it. A legitimate client never replays a
rotated token, so a replay means the token leaked or two clients share one
grant — both answered by revoking.

**The consent hand-off is a self-navigating document, not a 302.** The
`form-action 'self'` directive in this app's CSP is enforced against the
target of a post-submission redirect by some browsers and not others. The
flow would have worked in one browser and died at the final step in
another, with a console error no user reads. `form-action` governs where a
form may submit, not where a page may navigate.

**Login now honours a validated `callbackUrl`.** It was hardcoded to
`/app`, which would have dropped anyone who had to sign in mid-connection
onto the dashboard with no sign that the authorization was abandoned. An
open redirect on a login page is a phishing aid, so the validator accepts
only a relative path under `/app/`, or an absolute URL whose **parsed
origin** equals this deployment's own — never a string prefix, because
`https://ankora-website.vercel.app.evil.com/app/x` starts with the real
origin's characters and is a different site.

The absolute form is not hypothetical politeness. Following the redirect
chain on a preview deployment showed that Auth.js's middleware intercepts
the unauthenticated request to the consent screen before the page's own
redirect runs, and writes `callbackUrl` as a full URL. The first cut
accepted relative paths only, and would therefore have sent every real
sign-in to the dashboard — the exact silent break the validator exists to
prevent, arriving from the other direction. Reasoning did not find it;
walking the chain did.

### Verification

325 unit assertions pass, up from 278. PKCE is checked against RFC 7636's
own appendix B vector rather than only against itself. The redirect
matcher, the PKCE verifier and the login validator were each
mutation-tested.

One finding worth recording: mutation testing showed the
protocol-relative guard in `safeCallbackUrl` is unreachable — the `/app/`
prefix check already rejects those forms. It is kept as the layer that
holds if that check is ever loosened, and is now documented as redundant
rather than left looking load-bearing.

**Not verified:** no flow has run end to end against a browser. The
authorization code path, the consent screen and refresh rotation have not
been exercised against a deployment.

**Not planned:** exposing user management, password operations,
`integration.manage`, hour-bank adjustments or billing-policy edits
through MCP. Those are `SUPER_ADMIN` configuration actions and belong in
the UI, where a human is looking at what they are about to change.

Do not expand the tool list from a guess. Run Phase 2 with two or three
employees for a fortnight first — what people actually ask for will not be
the list anyone drew up in advance, and it is cheaper to discover that at
seven tools than at thirty.

---

## Phase 3 — making the connection visible (2026-09-21)

Phases 1 and 2 built a working MCP server and a working OAuth flow, and
then showed neither of them anywhere in the product. The grants existed
in `oauth_tokens`; the only way to answer "is Claude connected to my
account" was a `psql` query. A capability nobody can see is, for
practical purposes, a capability nobody has — and `/app/integrations`
actively said the opposite, in so many words: "אין עדיין חיבור פעיל לאף
מערכת".

Three things changed.

**A card, in two places.** `components/app/ClaudeConnectionCard.tsx` is
rendered by both `/app/integrations` and `/app/profile`. Integrations is
where the request started, and it is the right home for an integration —
but it is `SUPER_ADMIN`-only, while the grant is personal: each employee
authorizes their own account, with their own permissions. A card that
lived only there would have been visible exclusively to the one person
who least needs instructions. So both, from one component, differing by a
single prop (the org-wide adoption line).

**Liveness computed the same way the server computes it.**
`lib/app-domain/mcp-connections.ts` re-applies `lib/mcp/auth.ts`'s four
checks — not revoked, not expired, user still ACTIVE and not
soft-deleted, `tokenVersion` unmoved — rather than trusting the token row.
Check 4 is the one that earns its keep: "logout all sessions" works by
bumping that counter, so an admin who revokes a departing employee's
sessions sees them drop off this screen immediately, instead of reading
"מחובר" off a grant that now 401s.

Two deliberate departures from a naive reading of the table:

- Liveness is judged on the **refresh** horizon, not the access-token
  one. Access tokens live about an hour; keying the badge to them would
  show "לא מחובר" for a healthy connection that has merely been idle
  since lunch.
- `rotatedToId: null` is required. Refresh rotation writes a new row and
  points the old one at it, so every connection trails superseded rows.
  Counting those would render one connector as a dozen connections,
  growing hourly.

**One set of instructions, in the guide.** The setup steps live in
`/app/guide#mcp-claude` — the standing rule from ADR 0001 section 10 —
and the cards link to it rather than carrying their own copy. The RFC
9728 `resource_documentation` field now points there too; it previously
pointed at `/api/mcp`, which returned JSON-RPC to anyone who followed it.

### Not done, and why

**No in-app "disconnect" button.** Revocation today means removing the
connector in Claude, or an act that bumps `tokenVersion` (changing your
own password; an admin's "logout all sessions"). A real per-grant revoke
button is a write action on a credential — it wants an `AuditEvent`, a
confirmation step, and a decision about whether an admin may revoke
someone else's grant — and none of that was in scope for making the
thing visible. It is the obvious next increment. Until it exists, the
card says precisely what does revoke a grant rather than implying a
control that is not there.

**No per-user list on the Integrations screen.** The org view reports
`X of Y` and stops. Naming which employees have connected Claude would
be a new disclosure of per-person tooling on a screen that currently
reveals nothing about individuals, and no decision on that screen needs
it.

**`CLIENT_USER` never sees the card.** None of the ten tools are
reachable with that role, so offering the connection would be an
invitation to a dead end.
