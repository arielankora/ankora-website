import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "./auth.config";
import { authenticateWithPassword } from "@/lib/app-auth/authenticate";
import { consumeLoginLink } from "@/lib/app-auth/login-link";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        identifier: { label: "Email or username" }, // spec 4.2: email/username + password
        password: { label: "Password", type: "password" },
      },
      // Thin wrapper - all the actual login rules (generic failure
      // message, suspended/lockout checks, audit recording) live in
      // lib/app-auth/authenticate.ts, which is unit/integration-testable
      // on its own without going through NextAuth's request plumbing.
      async authorize(credentials) {
        return authenticateWithPassword(
          String(credentials?.identifier || ""),
          String(credentials?.password || "")
        );
      },
    }),
    // Portal phase 0: the one-time sign-in link. A second provider rather
    // than a magic `password` value inside the first one, so the two
    // paths can never be confused for each other and the link flow gets
    // its own audit action. All the rules (TTL, single use, CLIENT_USER
    // only, re-checking status at consume time) live in
    // lib/app-auth/login-link.ts, which is testable without NextAuth.
    Credentials({
      id: "login-link",
      credentials: { token: { label: "One-time token" } },
      async authorize(credentials) {
        return consumeLoginLink(String(credentials?.token || ""));
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as any).role;
        token.tokenVersion = (user as any).tokenVersion;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.sub;
        (session.user as any).role = token.role;
        (session.user as any).tokenVersion = token.tokenVersion;
      }
      return session;
    },
  },
});
