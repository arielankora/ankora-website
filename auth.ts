import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "./auth.config";
import { completePendingLogin } from "@/lib/app-auth/second-factor";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  // One provider, and it takes nothing but a pending sign-in. The password
  // and the emailed link are checked before it, in the sign-in actions,
  // and only produce a PendingLogin; the passkey, where one is needed, is
  // checked in between. So no request can turn a password alone into a
  // session by posting to Auth.js directly. All the rules live in
  // lib/app-auth/second-factor.ts, which is testable without NextAuth.
  providers: [
    Credentials({
      id: "pending-login",
      credentials: { token: { label: "Pending sign-in" } },
      async authorize(credentials) {
        return completePendingLogin(String(credentials?.token || ""));
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
