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

---

## Phase 4 — revoking a grant from inside the product (2026-09-21)

Phase 3 made the connection visible and said plainly what it did not
build: a way to end one. Revocation meant removing the connector inside
Claude, or an act that bumps `tokenVersion` — a password change, or an
admin's "logout all sessions". All three work. None of them is what an
admin reaches for when somebody leaves, and "change your password" is
not an answer to "how do you cut a third party's access to client data",
which is the form the question takes in a SOC 2 review.

**Two controls, because there are two situations.**

`revokeMyClaudeGrant` is self-service, per grant, on the card. Ownership
lives in the `WHERE` clause (`{ id, userId: actor.id }`) rather than in a
read-then-compare: a guessed or replayed id matches nothing, and a zero
count is the same answer for a wrong id as for someone else's, so a
caller learns nothing about grants that are not theirs.

`revokeClaudeGrantsForUser` is the admin path, gated on `user.manage`,
all-or-nothing, on the user detail screen next to "logout all sessions".
It deliberately does **not** bump `tokenVersion`. The two answer
different questions: "this account may be compromised" wants every
session gone, and already takes the Claude grants with it; "this person
no longer needs the integration" wants only the integration gone and
should not log them out of the app they are working in. The screen shows
the live grant count beside the button, because a control that looks
identical whether there are three grants or none gets pressed on a hunch.

### Decisions worth not re-litigating

**Soft revoke, never delete.** `revokedAt` is set; the row stays.
`lib/mcp/auth.ts` already treats a revoked row as a 401, so deleting
would buy nothing and lose the evidence that the grant existed and when
it ended. Consistent with the schema's own soft-delete-only convention.

**An OAuth disconnect revokes by client, not by row.** Rotation writes a
new row per renewal and revokes the one it supersedes, but a row that
rotated away and was not yet revoked would keep a valid access token
alive for up to an hour after the click. "Disconnect" has to mean
disconnected, so every live row for that `(userId, clientId)` goes.

**Confirm before, rather than undo after.** This is a deliberate
exception to the toast provider's rule that destructive actions offer a
real Undo. Un-revoking would resurrect a credential the person just
decided to kill. The recovery path is honest and takes seconds —
authorize again in Claude — so the safety sits in an explicit second
press, inline in the card, not in a reversal. No `window.confirm`: a
native modal blocks the page and looks nothing like the rest of this UI.

**`mcp_grant.revoke` classifies as הרשאות, not עריכה.** The audit
screen's `classifyAction` derives its tag from the action string.
Revoking a credential is an access change; left to fall through it would
have been tagged as a routine edit on the one screen an admin scans for
exactly this kind of event.

### Found by running it

Exercising the flow end to end on the preview — register a client,
approve consent, call `/api/mcp` with the token, press disconnect, call
again — turned up something the code review had not. The consent
endpoint has been writing an `mcp.oauth.granted` audit row since Phase
15, correctly, but the audit screen had no Hebrew label for that action
and no `OAuthClient` entry in its entity filter. So every grant since
Phase 15 has been landing in the log as a raw `mcp.oauth.granted`
string that could not be filtered for.

Fixed here, alongside the revoke labels. The lesson is the ordinary one:
`classifyAction` and `ACTION_LABEL` are a second place that every new
audited action has to be registered, and nothing enforced it.

Followed up immediately rather than waiting for a third occurrence,
because pulling the thread found fourteen more: the whole of Phase 10's
important-dates and reminder-rule actions, `profile.name_update`,
`profile.notification_preference_update`, `task.update`,
`client.restore` and `backup.nightly_export.sent` were all rendering as
raw English, and five entity types (`Task`, `ImportantDate`,
`ReminderRule`, `HolidayCalendarSubscription`, `System`) could not be
selected in the filter at all. The two registries now live in
`audit-log/labels.ts`, and `tests/unit/audit-labels.test.ts` scans every
`recordAudit` call site in `lib/` and `app/` and fails on an
unregistered action or entity type — in both directions, so a label left
behind by a deleted call site is caught too. Verified by removing a
label and an entity type and watching it fail on exactly those.

---

## Phase 5 — tasks (2026-09-21)

(Numbered 5 in this document's own sequence. The code comments call it
Phase 16, which is the repo-wide phase number the MCP work has used
since Phase 13 — the two schemes have coexisted throughout this ADR.)

The ten tools could answer "where did my week go" and record time, but
not "what do I need to do". That asymmetry made the connector a
reporting surface rather than an operational one, and it is the gap this
phase closes: `list_tasks`, `list_assignable_people`, `create_task`,
`update_task`, plus a `task` argument on `start_timer` and
`create_time_entry`.

### What this phase actually found

The intended work was to expose existing domain functions. It turned out
the domain functions were not there to expose.

Phase 10 added `Task.assignedToId` and `Task.dueDate` and wired
`important-dates-job.ts` to write both when it auto-creates a task from
an important date. Nothing was ever added to read or change them.
`createTask` took a title and a client; `updateTaskStatus` was the only
mutation; `listTasks` could filter by client, category and status and
nothing else. So production has carried tasks with an owner and a
deadline that no screen, no server action and no export could show —
data written by a cron job into columns with no readers.

That is why most of this change is in `lib/app-domain/tasks.ts` rather
than in the MCP layer. The MCP tools are one caller of the completed
domain; the Tasks screen is the other, and it gets the same fix for
free (including a `dueDate` leg in the sort order, so the list finally
reads soonest-first instead of ignoring deadlines it was already
storing).

### Decisions worth not re-litigating

**Assignment is gated on `time_entry.create_self`, not
`time_entry.edit_others`.** The obvious move was to reuse
`lookupTeamMember`, which already resolves a colleague by name. It
asserts the hours permission, because listing who works here in order to
read their timesheet is a real disclosure. Assigning work is a much
smaller thing to be allowed to do, and reusing that gate would have made
task assignment admin-only — which is not how a five-person operations
team works. `assignableUsers()` carries the narrower rule instead:
anyone who logs time may assign, and the people they can see are the
ones who share the client.

**An assignee must have access to the task's client.** Task visibility
has always been derived from client access, so assigning a task to
someone without access to that client files it where its owner can never
find it — a silent dead letter that looks exactly like success. The
domain layer refuses, with a message that says what to do about it.

**A due date is stored at the end of its day, in the user's timezone.**
Storing the start of the day would make every task due today read as
overdue from one minute past midnight. `overdue` is computed on the
server for the same reason `dueDate` is emitted as `YYYY-MM-DD` rather
than an instant: a model handed a bare date and left to compare it
against "now" gets the boundary day wrong about half the time.

**A finished task is never overdue.** Otherwise the archive reads as a
list of fires.

**`update_task` takes a patch, and clearing is explicit.** Omitting a
field leaves it alone; `clearAssignee` / `clearDue` empty it. A whole-
object update would let "change the due date" silently unassign the
task, and passing an empty string for "no owner" is exactly the kind of
ambiguity a model resolves confidently and wrongly.

### A pre-existing bug this surfaced

`TimeEntry.taskId` has been writable since Phase 2 and nothing ever
checked that the task belonged to the same client as the entry. The
invariant held only because the timer screen's picker is scoped to the
chosen client — precisely the "don't rely on the UI having hidden a
button" failure `permissions.ts` warns about. A second caller made it
reachable, so `assertTaskMatchesClient()` now runs in both `startTimer`
and `createManualEntry`. A mismatched pair would have filed one client's
hours under another client's task and corrupted both clients' reports,
quietly.

### Verification

- 400 unit assertions pass, up from 370; 20 of the new ones are on the
  task tools and 13 on the serializer
- `tests/unit/mcp/write-tools.test.ts` was extended rather than
  replaced: its exact-match assertion on `startTimer`'s arguments now
  names `taskId: null` deliberately, because an absent key and an
  explicit null are different instructions to the domain layer
- The contradiction guard and the end-of-day due date were each
  mutation-tested — removing the check fails exactly the test that
  should catch it

**Not verified: no task tool has run against a database.** The preview
build confirms the code typechecks against the real Prisma client and
that the existing suites still pass; it does not confirm that
`create_task` writes a row Ankora's own screen then shows. That is the
first thing to do after this merges.

---

## Phase 6 — the cost of a preamble (2026-09-21)

(Phase 17 in the code's repo-wide numbering.)

First real use of the task tools surfaced a complaint that had nothing
to do with tasks: "it keeps asking for permission, and that is not how
other connectors feel."

### What was actually happening

In Claude, each tool call is a permission prompt somebody has to click.
This server's instructions opened with **"Call list_my_clients and
list_categories first and use the names they return exactly as
written"**, and most tool descriptions repeated it per argument
("exactly as list_my_clients returned it"). `start_timer` told the model
to call `get_active_timer` first. `create_task` told it to call
`list_assignable_people` first.

So "open a task on RIMED for next week" was four tool calls and four
clicks, three of them preamble. Logging time was three. The connector
felt like it was asking permission constantly because it was — and the
prompts were for calls the user never asked for.

### Why the preamble was never needed

It was belt and braces, and the braces were always enough. Every tool
resolves names through `lib/mcp/lookup.ts`, which answers a miss with
"did you mean X or Y", built from what *this actor* may see. The
listing tools never told the model anything it could not learn by
simply trying the name and reading the refusal.

The same is true of the timer check: `start_timer` refuses when one is
already running, and `errors.ts` maps `ActiveTimerExistsError` to a
message that names the recovery. Checking first bought a click and
nothing else.

Listing is now what happens when a name does not resolve, or when the
user actually asks what exists.

### What this does not fix

The permission prompt itself is Claude's, not ours. `readOnlyHint` is a
hint a client may act on or ignore, and the annotations were already
correct — the read tools have carried `readOnlyHint: true` since Phase
13. Reducing the call count is the only lever this codebase has; whether
a given Claude surface offers "Allow always" is a client-side question.

### Guarded

`tests/unit/mcp/write-tools.test.ts` now fails on any tool description
or argument description that reinstates a "call X first" instruction, in
either its imperative form or the softer "exactly as list_X returned it".
It caught one on its first run — `create_task` still carried a
`list_assignable_people` preamble that the manual pass had missed.
