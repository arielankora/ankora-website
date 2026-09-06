import "server-only";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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
