# ADR 0006: the app's interface in Hebrew and English

Status: accepted (phase 1, infrastructure, and phase 2, the frame, built)
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
should not show 03/04 meaning April when the Hebrew one means March. The
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

Tests that call a server action or a route handler outside a Next request
get `next-intl/server` from `tests/__mocks__/next-intl-server.ts`: the
Hebrew dictionary, in Jerusalem time, which is what a reader who has not
chosen a language gets.

## Guards

* `tests/unit/i18n-translated-files.test.ts`: a translated screen shows no
  Hebrew written in its code. A file joins the list in the pull request
  that translates it, and never leaves it.
* `tests/unit/i18n-direction.test.ts`: no class in the product app pins a
  physical side (`mr-2`, `text-right` and the like). `rtl:`, `ltr:` and a
  `dir=` variant are allowed, because those choose a side on purpose. The
  utilities `text-page-start` and `text-page-end` (`app/globals.css`) align
  to the page's side on elements whose own direction is `auto`.
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

## What comes next, in order

1. Screens, one pull request per area: tasks with the timer and my time,
   then client files and processes, knowledge and approvals, then reports
   and the admin screens.
2. The guide: translated, or a short English guide in its place.
3. The process flow editor (`FlowEditor.tsx`) sets its cards to `rtl` and
   orders their exits for Hebrew; it needs its own change for English.
4. Outgoing channels by the recipient's language: email, notifications,
   PDF and exports.
5. Translating content on request, under the "בלי AI" rule above.
6. The client portal, if clients ask for English. Until then the language
   picker is offered to staff only.

Until the screens a person uses are translated, choosing English shows
those screens in Hebrew laid out left to right. That is expected in this
phase and is the reason the screens come next.
