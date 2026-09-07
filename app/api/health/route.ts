import "server-only";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, db: "up", time: new Date().toISOString() });
  } catch {
    // No error detail in the body on purpose - just enough for an
    // external monitor to page someone, not enough to leak DB internals.
    return NextResponse.json(
      { ok: false, db: "down", time: new Date().toISOString() },
      { status: 503 }
    );
  }
}
