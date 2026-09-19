# ADR 0004 — Nonce-based CSP: investigated, measured, rejected

Status: rejected (with a smaller change adopted in its place)
Date: 2026-09-19
Context: follow-up to the OWASP review (PR #39) and the Next 15 upgrade (PR #41).

## The open question

The Content-Security-Policy added in PR #39 keeps `'unsafe-inline'` in
`script-src`, because the App Router emits inline bootstrap and hydration
scripts on every page. Removing it requires a per-request nonce. That was
recorded as the last open item of the security review.

This document records what happened when it was actually attempted, so
nobody re-opens it on the assumption that it was merely skipped.

## Finding 1 — a nonce converts static pages into dynamic ones

A nonce has to reach the page, which means reading it from `headers()`.
`headers()` is a dynamic API, so any route that touches it opts out of
static generation.

Measured on a minimal Next 15.5.25 app with two otherwise-identical pages:

    Route (app)
    ├ ƒ /nonce-page      <- reads headers() for the nonce
    └ ○ /static-page     <- identical, no nonce

    ○  (Static)   prerendered as static content
    ƒ  (Dynamic)  server-rendered on demand

The marketing site currently prerenders 91 static pages. Noncing it would
turn every one of them into an on-demand server render: slower TTFB, a
serverless invocation per page view, and a larger bill — on a public
marketing site that holds no session and no data worth stealing.

That rules out a nonce for `/:path*` on its own.

## Finding 2 — on /app a nonce is free, but the obvious implementation silently does nothing

`/app` is already fully dynamic (every route calls `requireUser()`, which
reads cookies), so Finding 1 costs nothing there. `/app` also has no
inline scripts of its own — the gtag snippet and `JsonLd` both live under
`app/[locale]`. So a nonce on `/app` looked like pure upside.

The standard implementation wraps the existing Auth.js middleware:

    export default auth((req) => {
      const nonce = crypto.randomUUID().replace(/-/g, "");
      const requestHeaders = new Headers(req.headers);
      requestHeaders.set("x-nonce", nonce);
      requestHeaders.set("Content-Security-Policy", csp(nonce));
      const res = NextResponse.next({ request: { headers: requestHeaders } });
      res.headers.set("Content-Security-Policy", csp(nonce));
      return res;
    });

Built and run against a harness mirroring this repo's `auth.config.ts`.
Two results:

**The auth gate survives.** An unauthenticated request to a protected
route still returns `307` to `/app/login?callbackUrl=...`, and the public
login path still returns `200`. Good.

**But the policy is never applied.** The response carried no
`Content-Security-Policy` header at all, and 0 of 11 script tags had a
nonce. When Auth.js's `auth()` wrapper is given a handler and the
`authorized` callback returns true, it returns its own response and the
handler's is discarded.

This is the important part: it fails *silently*. The build is green, the
auth gate works, nothing logs a warning — and the security control is
simply absent. Shipped, it would have read as hardening in the config and
in the PR description while delivering nothing. That is worse than not
doing it, because it stops anyone from looking again.

Making it genuinely work means not wrapping: running the auth logic
directly, inspecting its response, and hand-copying its `Set-Cookie`
headers onto a new `NextResponse.next({ request: { headers } })`. That is
surgery on the single gate in front of the entire product, and
hand-copying session cookies is exactly where subtle session bugs come
from.

## Decision

Do not implement a nonce-based CSP.

The benefit is defense-in-depth against an XSS vector this codebase does
not currently have: there is no user-generated HTML rendering anywhere in
`/app`, React escapes all interpolated content, and `connect-src 'self'`
already removes the exfiltration payoff that makes most XSS worth
exploiting. Against that, the cost is auth-middleware surgery whose
failure mode is invisible.

## What was adopted instead

A dedicated, strictly same-origin CSP for `/app/:path*` (see
`next.config.mjs`). `/app` previously inherited the marketing policy,
which whitelists `https://www.googletagmanager.com` as a **script**
source. `/app` loads no analytics and references no external URL at all,
so that allowance bought nothing — while GTM is a well-known CSP bypass
vector, since a container can be configured to load further arbitrary
scripts. On the surface holding sessions, client data and the audit log,
that was the weakest line in the policy.

Every directive in the new `/app` policy is `'self'` or `'none'`. This is
a config-only change with no effect on authentication, and it is
fail-safe: if the rule ever stops matching, `/app` falls back to the
broader policy rather than losing its CSP.

## Revisit if

- Next.js ships first-class nonce support that does not require reading
  `headers()` in the page (which would void Finding 1), or Auth.js
  documents a supported way to add response headers from its middleware
  wrapper (which would void Finding 2).
- `/app` ever renders user-supplied HTML, or a third-party script is
  added to it. Either changes the benefit side of the trade materially.
