import "server-only";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/app-auth/password";
import { isLockedOut, recordFailedLogin, clearFailedLogins } from "@/lib/app-auth/login-attempts";
import { recordAudit } from "@/lib/app-auth/audit";

export type AuthenticatedUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  tokenVersion: number;
};

// Extracted from the NextAuth Credentials provider's `authorize()` so the
// actual login rules - generic failure message (spec 20), suspended/
// archived accounts blocked before password check, graduated lockout,
// failed-attempt/audit recording - are independently testable against a
// real database, without needing to exercise NextAuth's request/response
// plumbing. auth.ts's Credentials provider is a thin wrapper around this.
export async function authenticateWithPassword(
  rawIdentifier: string,
  rawPassword: string
): Promise<AuthenticatedUser | null> {
  const identifier = rawIdentifier.trim().toLowerCase();
  const password = rawPassword;
  if (!identifier || !password) return null;

  const user = await prisma.user.findFirst({
    where: {
      deletedAt: null,
      OR: [{ email: identifier }, { username: identifier }],
    },
  });

  // Same generic failure path whether the account doesn't exist or the
  // password is wrong - spec 20: don't leak which one it was.
  if (!user) return null;

  if (user.status !== "ACTIVE") {
    // Spec 22 AC: "suspended user חסום." Do not attempt password
    // verification or touch failed-attempt counters for a non-active
    // account - the account state itself is the block.
    return null;
  }

  if (isLockedOut(user)) return null;

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    await recordFailedLogin(user.id, user.failedLoginAttempts);
    await recordAudit({
      actorId: user.id,
      action: "login.failure",
      entityType: "User",
      entityId: user.id,
    });
    return null;
  }

  await clearFailedLogins(user.id);
  await recordAudit({ actorId: user.id, action: "login.success", entityType: "User", entityId: user.id });

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    tokenVersion: user.tokenVersion,
  };
}
