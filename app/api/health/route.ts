import "server-only";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/// The commit this build was made from, seven characters of it.
///
/// Vercel injects the full SHA at build time. It is read here, at module
/// scope, because that is the only moment it exists: the variable is a
/// build-time value and reading it per request would return the same
/// thing anyway.
///
/// Why an unauthenticated endpoint may say it. A private repository's
/// commit hash is not a secret and cannot be turned into one: it names a
/// commit nobody outside the repository can fetch. What it buys is the
/// one question no other public surface can answer, which is whether the
/// code serving this request is the code on `main`. See
/// .github/workflows/deploy-drift.yml, and claude/deploy-migration-lock,
/// for the failure that made the question worth asking: a merge whose
/// deployment died, leaving production on the commit before it with
/// nothing anywhere saying so.
const COMMIT = (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7) || null;

// Overnight bug-hunt (docs/adr/0001 section 19.1): without this, Next.js
// statically optimizes this route at build time - nothing in the handler
// (no cookies/headers/searchParams) signals dynamic rendering to its
// static analysis, so the Prisma call and `new Date()` both only ever
// ran once, at build time. Confirmed live: production was serving the
// exact same frozen timestamp and "db":"up" on every request regardless
// of actual DB state, since the deployment that added this endpoint
// (Phase 7) - defeating the entire point of a health check for an
// external uptime monitor.
export const dynamic = "force-dynamic";

// Spec 24's pre-production checklist: "Error tracking and health
// endpoint." Deliberately unauthenticated - an external uptime monitor
// has no session/credentials to send, and this reveals nothing sensitive
// (no stack traces, no secrets - spec 16.2's "logs לא מכילים... תוכן
// רגיש" applies equally to any response body). ADR addendum section 14.4:
// no external error-tracking (Sentry et al.) is wired up yet - that needs
// an account/API-key decision that belongs to Ariel, not a default this
// engagement should pick silently.
//
// Two depths, and the default is the shallow one (27.10.2026).
//
// Every call used to run `SELECT 1`. Neon suspends an idle compute after
// five minutes, and on 16.10 an uptime monitor started calling this route
// once a minute from four locations, with deploy-drift.yml adding three
// calls an hour. The database never went idle again: about 6 CU-hours a
// day, the whole 100 CU-hour free allowance gone by 26.10, and a written
// warning from Neon that the compute was at risk of suspension - which
// would have taken the entire product down to keep a monitor green.
//
//   GET /api/health        Is the app serving, and which commit. No
//                          database. Safe to poll every minute.
//   GET /api/health?db=1   Also proves the database answers. Wakes the
//                          compute if it was asleep, so poll it rarely
//                          (the uptime monitor checks it hourly).
//
// The shallow body says `"db":"not-checked"` rather than leaving the key
// out, so nothing that reads it can mistake silence for "up".
export async function GET(request: Request) {
  const deep = new URL(request.url).searchParams.get("db") === "1";
  const time = new Date().toISOString();

  if (!deep) {
    return NextResponse.json({ ok: true, db: "not-checked", commit: COMMIT, time });
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, db: "up", commit: COMMIT, time });
  } catch {
    // No error detail in the body on purpose - just enough for an
    // external monitor to page someone, not enough to leak DB internals.
    return NextResponse.json({ ok: false, db: "down", commit: COMMIT, time }, { status: 503 });
  }
}
