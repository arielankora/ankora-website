// Pure lockout-window logic, deliberately split out of login-attempts.ts
// (which needs a live Prisma client to persist failed-attempt counts) so
// it has zero dependencies and can be unit-tested without a database or
// generated Prisma client.
export function isLockedOut(user: { lockedUntil: Date | null }): boolean {
  return !!user.lockedUntil && user.lockedUntil.getTime() > Date.now();
}
