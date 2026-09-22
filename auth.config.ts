import type { NextAuthConfig } from "next-auth";

// Edge-safe half of the Auth.js config (used by middleware.ts, which runs
// on the Edge runtime and cannot use Prisma directly against a normal
// Postgres connection). No providers/DB access here - just enough to make
// a fast, coarse "is there a session at all" redirect decision. The
// authoritative, DB-backed check (role, status=ACTIVE, tokenVersion still
// current) happens server-side in lib/app-auth/session.ts on every
// protected request, per spec 4.1: "כל Endpoint בשרת בודק Authorization."
export const authConfig = {
  pages: {
    signIn: "/app/login",
  },
  session: {
    strategy: "jwt",
  },
  callbacks: {
    authorized({ auth, request }) {
      const path = request.nextUrl.pathname;
      // Public, unauthenticated sub-routes under /app - login itself, plus
      // the self-service password-reset flow (a locked-out or brand-new
      // user has no session yet, so gating these behind auth would make
      // the flow unreachable).
      // "/app/login-link" is public for the same reason as the reset flow: a
      // client arriving from the emailed link has no session yet, and the
      // token in the URL is what authorises them.
      const PUBLIC_APP_PATHS = ["/app/login", "/app/login-link", "/app/forgot-password", "/app/reset-password"];
      const isPublic = PUBLIC_APP_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
      const isProtected = path.startsWith("/app") && !isPublic;
      if (!isProtected) return true;
      return !!auth?.user;
    },
  },
  providers: [],
} satisfies NextAuthConfig;
