# ADR 0005 — MCP server: letting Ankora employees reach the app through Claude

Status: accepted (Phase 1 built; Phases 2–3 planned, not started)
Date: 2026-09-20
Context: Ariel asked for two-way communication between the Ankora app and
Claude. This document records the scope that was chosen, the two findings
that shaped it, and what is deliberately left for later.

## Scope

Ankora **employees** read and write their own Time Tracking data through
Claude Desktop. Client-facing access (a `CLIENT_USER` reaching the Client
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

`tests/unit/mcp/` covers the four pure modules (59 assertions). The rest
of `lib/mcp/` is Prisma-touching and falls under the same sandbox
limitation documented in `tests/unit/reports.test.ts`.

The migration is hand-authored for the same reason as every prior phase's
— see that file's header.

## What comes after

**Phase 2 — writes.** `start_timer`, `stop_timer`, `update_timer_note`,
`create_time_entry`. Three things land before the first one ships:

1. **A `createdVia` marker on `TimeEntry`.** `TimeEntrySource` is
   `MANUAL | TIMER` today, which cannot distinguish an entry a person
   typed from one Claude created. Without it the first bad write is
   untraceable. This is a ten-line migration and it is not optional.
2. **Name resolution wired into every write tool** (`lib/mcp/resolve.ts`,
   already built and tested).
3. **RBAC integration tests** under `tests/integration/mcp/`, running each
   tool against a seeded user of each of the four roles. A permission leak
   is the only bug on this surface that is genuinely dangerous; the
   regression-test pattern in `tests/unit/permissions.test.ts` is the
   model to follow.

Write tools also flip the `annotations` block in `lib/mcp/tools.ts` —
`readOnlyHint: true` is what tells a client these are safe to call without
asking, and copying it onto a write tool would be a real mistake.

**Phase 3 — OAuth**, which retires the bridge and opens claude.ai, mobile
and Cowork. This is also the prerequisite for anything client-facing: the
permission split already exists (`report.client.view` vs
`report.internal.view`, and `client-portal.ts`'s `resolvePortalClient`
scoping), so a `CLIENT_USER` surface is mostly a narrower tool list over
`lib/app-domain/client-portal.ts` — but only once each client user
authenticates as themselves, which is exactly what Finding 2 says the
static-header path cannot do.

**Not planned:** exposing user management, password operations,
`integration.manage`, hour-bank adjustments or billing-policy edits
through MCP. Those are `SUPER_ADMIN` configuration actions and belong in
the UI, where a human is looking at what they are about to change.

Do not expand the tool list from a guess. Run Phase 2 with two or three
employees for a fortnight first — what people actually ask for will not be
the list anyone drew up in advance, and it is cheaper to discover that at
seven tools than at thirty.
