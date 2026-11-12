# ADR 0006: the app's interface in Hebrew and English

Status: accepted (phases 1 to 3 built: infrastructure, the frame, tasks with the timer and my time)
Date: 2026-11-12
Context: an English-speaking product manager joins on 12.11.2026 with full
permissions, to work on the product and on client work. The app was Hebrew
only and right to left. Ariel asked for it to be done properly, without
shortcuts. This document records how the app speaks two languages, what
phase 1 built, and what is deliberately left for the phases after it.

## Decisions

### 1. The language belongs to the person, not the URL

`User.locale` (enum `AppLocale`: `he`, `en`, default `he`) decides the
language and the page direction. There is no locale in the app's URLs: a
link a colleague pastes must open in the reader's language, not the
writer's. The marketing site keeps its own `[locale]` routing and its own
dictionaries (`content/he.ts`, `content/en.ts`); the two never share a
dictionary.

When nobody is signed in (the sign-in screens, an expired session), the
cookie `ankora_app_locale` decides. It is set when a person saves their
language and only remembers the last choice on that browser. Anything it
holds that is not one of the app's locales is ignored.

Resolution lives in `lib/i18n/resolve.ts`, configuration in
`lib/i18n/config.ts`, and next-intl reads it through `i18n/request.ts`.

### 2. next-intl, without its routing

next-intl gives server components, client components and server actions
the same dictionary, ICU plurals, and date and number formatting in the
person's locale and time zone. Only its request configuration is used: no
middleware and no locale routing. Keys are typed from `messages/he.json`
(`types/next-intl.d.ts`), and `i18n/request.ts` makes the English
dictionary type check against the Hebrew one.

Pinned to 4.14.9, with `use-intl`, `icu-minify` and `@swc/core` pinned
through `overrides`: the newest releases were days old when this was
added, and a dependency that new has not had time to be looked at.

### 3. Dates in English are en-IL

Day first, 24 hours, shekels: the work is in Israel, and an English screen
should not show 03/04 meaning April when the Hebrew one means March. For
that, next-intl's locale is the Intl tag (`he-IL`, `en-IL`), not the bare
language; the page's `lang` and `dir` come from the person's setting. (In
phase 1 it was the bare language, and English dates came out US style;
fixed with phase 2, with a test.) The
time zone is the person's own (`User.timezone`), checked against Intl,
with Jerusalem as the fallback.

### 4. Only the interface is translated

Client files, tasks, notes and every other thing people write stay in the
language they were written in. Fields that show what people wrote get
`dir="auto"`, so a Hebrew name inside an English screen reads correctly,
and the reverse.

Translating content is a later phase, and it must go through the same
"בלי AI" check every AI reader goes through (`lib/ai-exclusion.ts`):
material a client asked to keep away from AI is never translated by AI.
Until then, the new product manager does not work on clients marked
"בלי AI" (Ariel, 12.11.2026).

### 5. Pages that stay in Hebrew

`components/app/HebrewOnly.tsx` keeps a page in Hebrew and right to left
for every reader: the agreements a person signs and the pages a client
opens from a link. (The sign-in screens were kept this way in phase 1
and translated in phase 2.) A
translation of a legal text is a decision for a person to make, never a
side effect of a language setting.

### 6. Refusals carry codes

A domain function that refuses says why with a code, and keeps its Hebrew
message for callers that already show it. The screen turns the code into a
sentence in the reader's language. Phase 1 does this for the profile
(`ProfileError`, and `code` on `validatePasswordPolicy`); phase 2 for
sign-in and identity checks (`SecondFactorError`, `PasskeyError`, the
step-up errors, the password reset and the Claude disconnect), worded in
one place, `lib/i18n/auth-errors.ts`. Each screen that is translated does
the same for its own domain.

Route handlers send the translated sentence in their JSON `message`. A
failure that happens in the browser (a cancelled passkey prompt) comes
back from `components/app/vault/webauthn-client.ts` as a `reason`, and the
screen words it.

From phase 3 the general form is `DomainError(code, message, values)`
(`lib/domain-error.ts`): an Error whose message is unchanged, so MCP tools
and tests that read it are unaffected, with a code under `domainErrors` in
the dictionaries. `domainErrorText(err)` (`lib/i18n/domain-errors.ts`) words
it for the reader. The typed errors behind the timer and time entries
(`OverlapError`, `ClosedBankError` and the rest) extend it.
`tests/unit/i18n-domain-errors.test.ts` checks that every code thrown,
directly or through a subclass, exists in both dictionaries with the
placeholders the throw fills.

Tests that call a server action or a route handler outside a Next request
get `next-intl/server` from `tests/__mocks__/next-intl-server.ts`: the
Hebrew dictionary, in Jerusalem time, which is what a reader who has not
chosen a language gets.

### 7. The browser gets only the namespaces it reads, per area

The dictionary is serialised into every page and into every server action
response that re-renders the layout, and most of it (domain errors, server
pages, the guide) is read only on the server. Found when the browser suite
showed server action responses doubling after phase 3, and growing again
after phase 4.

So the root provider passes only the shell's namespaces
(`GLOBAL_MESSAGE_PATHS`), and each area of the app (a folder under
`app/(product)/app/(authenticated)`) adds its own in its layout
(`components/app/ScopedMessages.tsx`, `AREA_MESSAGE_PATHS`). Both lists are
generated from the code by `scripts/i18n/route-messages.mjs`: it follows the
imports from each area's files and collects what they pass to
`useTranslations`, the only way a component reads the dictionary in the
browser. The home page counts as the shell, because it sits beside the
areas' layout rather than in a folder of its own.

## Guards

* `tests/unit/i18n-translated-files.test.ts`: a translated screen shows no
  Hebrew written in its code. A file joins the list in the pull request
  that translates it, and never leaves it.
* `tests/unit/i18n-direction.test.ts`: no class in the product app pins a
  physical side (`mr-2`, `text-right` and the like). `rtl:`, `ltr:` and a
  `dir=` variant are allowed, because those choose a side on purpose. The
  utilities `text-page-start` and `text-page-end` (`app/globals.css`) align
  to the page's side on elements whose own direction is `auto`.
* `tests/unit/i18n-route-messages.test.ts`: the generated lists match the
  code, every area folder has its `ScopedMessages` layout, and every listed
  namespace exists. Component tests render with the union of all the lists
  (`tests/helpers/intl.tsx`), so a namespace no page sends fails there too.
* `tests/unit/i18n-messages.test.ts`: both dictionaries have the same keys,
  the same placeholders, nothing empty, no long dashes, no Hebrew in the
  English one, and every message formats.

## Phase 1, what was built

The infrastructure above, the shell (sidebar, top bar, phone navigation,
command palette, notifications, timer pill, offline banner, toasts, error
and not found pages) and the profile screen, with a language picker for
staff. Thirteen physical classes were replaced, and the arrows that mean
"back" and "forward" turn around in a left to right page.

Found on the way: AppShell, a server component, imported `ACCOUNT_GROUP`
from Sidebar, a client component. The server receives a reference to
client code, not the value, so the top bar printed a function on the
profile, notifications and guide screens. The groups now live in
`components/app/nav-groups.ts`, a plain module.

## Phase 2, what was built

The frame: every sign-in screen (password, two-step verification, adding
a device, password reset, the emailed link), the Claude connection consent
page, and the rest of the profile (the passkeys card and the Claude card,
shared with the integrations screen). With it, everything from signing in
to the profile is in the reader's language. Email and login fields, which
are always left to right, align to the page's side (`text-page-start`).
The legal links on the sign-in page point at the marketing site in the
reader's language.

## Phase 3, what was built

Tasks (list, board, the new task form, the single task screen with its
steps, plan, thread, sharing and notes), the timer, and my time, with the
refusals behind them (tasks, time entries, closed hour banks, plans, portal
notes, run lessons, vendor checks) and the small shared components they use
(drawer, not found, forbidden, loading and error states, the action form's
fallback). Dictionary fragments are merged with
`scripts/i18n/merge-messages.mjs`, which refuses to overwrite a key.

Left in Hebrew on purpose, because it is content and not interface: the
message a colleague receives from "share" on a task, the notes a client
reads in the portal, the prompt "advance with Claude" copies, the text
"message the client" sends, and the line written into a moved entry's
note. Still in Hebrew because the source is shared with screens not yet
translated: the waiting-on labels from `lib/app-domain/portal-labels.ts`,
thread event labels built in lib, the reminder after a task is closed
(`procedure-to-file`), and the calendar's copy of the "mine" scopes.

## What comes next, in order

1. Screens, one pull request per area: client files and processes,
   knowledge and approvals, then the calendar, reports and the admin
   screens.
2. The guide: translated, or a short English guide in its place.
3. The process flow editor (`FlowEditor.tsx`) sets its cards to `rtl` and
   orders their exits for Hebrew; it needs its own change for English.
4. Outgoing channels by the recipient's language: email, notifications,
   PDF and exports.
5. Translating content on request, under the "בלי AI" rule above.
6. The client portal: done, see "The client portal" below.

## The client portal (12.11.2026)

Decided by Ariel on 12.11.2026, and built with it:

* The portal is translated (every screen under `portal/`, the context bar
  and the document download's refusal), and the language picker on the
  profile is offered to everyone, client users included.
* A client marked "בלי AI" may have the English interface as well. The
  interface comes from the dictionary, written in advance by people; no AI
  reads or writes anything of theirs to show it.
* The confidentiality undertaking and the agreement signing and upload
  pages stay in Hebrew (`HebrewOnly`, decision 5), unchanged.
* Prompts to Claude stay in Hebrew.
* What people wrote is never translated: notes to the client, outcomes,
  what we need from them, task and decision titles, the client file's
  items, the monthly summary. It is shown with `dir="auto"`.

Labels that the portal shares with Hebrew output keep their lib functions
for that output (`portalHeadline`, `PORTAL_STAGE_LABELS`, `DIGEST_LABELS`,
the knowledge tags, `autoSendLabel`, `describeForecast`), and the screens
word the same answer from the dictionary (`portalHeadlineKey`, the
`tagCode` and `date` on a knowledge item, `autoSend`). What the portal
sends out (the monthly export as PDF and Excel, the emails, the MCP
answers) stays in Hebrew until outgoing channels follow the recipient's
language (item 4 above).

Until the screens a person uses are translated, choosing English shows
those screens in Hebrew laid out left to right. That is expected in this
phase and is the reason the screens come next.

## Outgoing channels, part A (12.11.2026)

What the app sends to a person who has an account, staff or a client
user, is written in that person's language (`User.locale`), whoever
caused it and whatever request (or cron) it runs in.

* `lib/i18n/outgoing.ts`: `translatorFor(locale, timeZone)` returns the
  `outgoing` namespace (`t`), a formatter, and the direction and sides an
  email layout needs. It reads the dictionaries directly with next-intl's
  `createTranslator`, because `getTranslations` reads the current
  request, which is the sender's. `HEBREW` is the default every builder
  falls back to.
* `lib/i18n/recipients.ts`: `outgoingForUser(s)` and `outgoingOf(row)`
  read the person's row; `groupEmailsByLocale` splits a typed-in address
  list (an alert rule's Ankora list, a reminder's extra addresses, the
  vault alert's) by the language of the app user behind each address, one
  send per language. An address that is no app user's keeps Hebrew.
* Bell rows are worded when they are created, in the recipient's language;
  the schema is unchanged, so a row keeps the language it was written in
  if the person changes theirs later.
* Emails: the action layout (`renderActionEmail`), the morning digest and
  the weekly metrics email take the recipient's `Outgoing` and turn the
  layout with it (`dir`, `lang`, `align`).
* An invite goes out in the language set for the new account
  (`inviteUser`'s `locale`, read from the form's `locale` field when it
  sends one), Hebrew otherwise.

Still Hebrew, for part B or by decision: anything to people who are not
app users (client contacts, the client copy of an hour bank alert,
scheduled reports, messages staff write to clients, WhatsApp, procedure
steps sent through the person's Gmail), PDFs and exports, the nightly
backup email, prompts to Claude and MCP answers. Text people wrote, and
lines lib/ builds as a record (a process review's cause, a failing
check's message, the reason stored on an auto-apply pause), are put into
the message as they are.
