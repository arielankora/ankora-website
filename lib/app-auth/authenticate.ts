import "server-only";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/app-auth/password";
import { isLockedOut, recordFailedLogin, clearFailedLogins } from "@/lib/app-auth/login-attempts";
import { recordAudit } from "@/lib/app-auth/audit";

// A real bcrypt digest at the same cost factor (12) the app uses for
// genuine passwords - see the timing-oracle comment in
// authenticateWithPassword below. Its plaintext is a fixed nonsense
// string, and nothing ever writes this value into User.passwordHash, so
// it cannot authenticate anyone. Being a real hash (not a sleep, not a
// truncated string) is what makes the comparison cost genuinely match
// the real path.
const DUMMY_PASSWORD_HASH = "$2b$12$gwMIZwbO1frHZlH9PsDfv.L7U43iMmum7kuKTI.JRo5IRxCPuryJa";

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
  //
  // Security review (OWASP A07:2021; CWE-208, "Observable Timing
  // Discrepancy"). The generic MESSAGE was already right, but the timing
  // was not: returning here immediately skipped the bcrypt comparison
  // below, and bcrypt at cost 12 deliberately takes ~250-400ms. A
  // non-existent identifier therefore answered in a few milliseconds
  // while a real one took a third of a second - a reliable, fully
  // automatable oracle for enumerating who has an account, which is the
  // reconnaissance step before a targeted phishing or spraying campaign.
  //
  // Burning an equivalent bcrypt comparison against a fixed dummy hash
  // flattens the two paths. The hash below is a real bcrypt digest at the
  // same cost factor (12) of a value no one can log in with, so the work
  // done is genuinely equivalent rather than an approximate sleep.
  if (!user) {
    await verifyPassword(password, DUMMY_PASSWORD_HASH);
    return null;
  }

  if (user.status !== "ACTIVE") {
    // Spec 22 AC: "suspended user חסום." The account state itself is the
    // block - the password is never actually checked and failed-attempt
    // counters are deliberately not touched. The dummy comparison exists
    // only to keep this path's timing indistinguishable from the normal
    // one (same CWE-208 reasoning as the not-found branch above);
    // its result is intentionally discarded.
    await verifyPassword(password, DUMMY_PASSWORD_HASH);
    return null;
  }

  if (isLockedOut(user)) {
    // Same reason: without this, a locked account answers noticeably
    // faster than an unlocked one, which tells an attacker their spray
    // hit a real account and exactly when the lockout window lapses.
    await verifyPassword(password, DUMMY_PASSWORD_HASH);
    return null;
  }

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
