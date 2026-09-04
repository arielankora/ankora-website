import "server-only";
import { prisma } from "@/lib/prisma";
export { isLockedOut } from "@/lib/app-auth/lockout";

// Graduated lockout: doubles with each run of consecutive failures, capped.
// 5 fails -> 1 min, 6 -> 2 min, 7 -> 4 min ... capped at 30 min. Spec 4.2
// only asks for "rate limiting and graduated lockout," not a specific
// curve - this is a documented, deliberately simple default.
const FAILURES_BEFORE_LOCKOUT = 5;
const BASE_LOCKOUT_MS = 60_000;
const MAX_LOCKOUT_MS = 30 * 60_000;

export async function recordFailedLogin(userId: string, currentFailures: number) {
  const nextFailures = currentFailures + 1;
  let lockedUntil: Date | null = null;
  if (nextFailures >= FAILURES_BEFORE_LOCKOUT) {
    const overBy = nextFailures - FAILURES_BEFORE_LOCKOUT;
    const delay = Math.min(BASE_LOCKOUT_MS * 2 ** overBy, MAX_LOCKOUT_MS);
    lockedUntil = new Date(Date.now() + delay);
  }
  await prisma.user.update({
    where: { id: userId },
    data: { failedLoginAttempts: nextFailures, lockedUntil },
  });
}

export async function clearFailedLogins(userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
}
