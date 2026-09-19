import { NextResponse } from "next/server";
import { checkPassword, createSessionToken, isAdminConfigured, ADMIN_COOKIE } from "@/lib/adminAuth";
import { rateLimitResponse } from "@/lib/rate-limit";

// Security review (OWASP A07:2021 - Identification and Authentication
// Failures). This endpoint had NO brute-force protection of any kind: one
// shared password, no account to lock out, no delay, no attempt ceiling.
// It is also the highest-value target in the app, because the session it
// hands out lets the holder publish, overwrite and DELETE files in the
// GitHub repo through a contents:write token (lib/github.ts).
//
// 10 attempts per IP per 15 minutes. Generous enough that Ariel fat-
// fingering the password several times is never locked out in practice,
// restrictive enough that an online dictionary attack is no longer
// viable. See lib/rate-limit.ts for the honest limits of an in-memory
// counter on serverless, and why edge-level limiting is the durable fix.
const LOGIN_ATTEMPT_LIMIT = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export async function POST(request: Request) {
  const limited = rateLimitResponse(request.headers, "admin-login", LOGIN_ATTEMPT_LIMIT, LOGIN_WINDOW_MS);
  if (limited) return limited;

  if (!isAdminConfigured()) {
    return NextResponse.json(
      { error: "Admin isn't configured on this environment yet (missing ADMIN_PASSWORD / ADMIN_SESSION_SECRET)." },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const password = typeof body.password === "string" ? body.password : "";

  if (!password || !checkPassword(password)) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  const token = createSessionToken();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
