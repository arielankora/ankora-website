import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

// Edge-runtime coarse gate: redirects to /app/login if there's no session
// JWT at all. This is a UX fast-path only - the authoritative, DB-backed
// check (status=ACTIVE, tokenVersion current, role) happens server-side in
// lib/app-auth/session.ts on every protected page/route, because Prisma
// with a direct Postgres connection cannot run on the Edge runtime that
// middleware uses. See auth.config.ts for why this file has no providers.
export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  matcher: ["/app/:path*"],
};
