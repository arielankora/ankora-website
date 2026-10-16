import "server-only";
import { prisma } from "@/lib/prisma";
import { afterResponse } from "@/lib/after-response";

// When a person was last active (User.lastSeenAt).
//
// lastLoginAt moves only on a password or link sign-in, and a session
// lasts for weeks, so in production Ariel showed 10.10 on a day he was
// using the app. The weekly agent asks "did this person leave?" after 21
// quiet days; reading lastLoginAt it would flag people at their desks.
//
// Every authenticated page load and every MCP call passes through here.
// Writing on each would be a database write per request, so it writes at
// most once an hour per person, and never in the request's way: the write
// runs after the response (lib/after-response.ts), and a failure is logged
// and dropped. Being an hour stale costs nothing at a 21-day threshold.

export const LAST_SEEN_THROTTLE_MS = 60 * 60 * 1000;

/// Pure: is the stored value missing or older than the throttle window?
export function shouldTouchLastSeen(lastSeenAt: Date | null | undefined, now: Date = new Date()): boolean {
  if (!lastSeenAt) return true;
  return now.getTime() - lastSeenAt.getTime() >= LAST_SEEN_THROTTLE_MS;
}

/// The conditional the write carries. The check above was made on a row
/// read earlier in the request; between then and now another request may
/// already have written. Repeating the condition in the UPDATE makes that
/// harmless: only one of two racing requests matches, and a value written
/// a moment ago is never replaced by an older `now`.
export function lastSeenWhere(userId: string, now: Date) {
  return {
    id: userId,
    OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: new Date(now.getTime() - LAST_SEEN_THROTTLE_MS) } }],
  };
}

export async function touchLastSeen(user: { id: string; lastSeenAt?: Date | null }, now: Date = new Date()): Promise<void> {
  if (!shouldTouchLastSeen(user.lastSeenAt, now)) return;
  await afterResponse("[last-seen] update", () =>
    prisma.user.updateMany({ where: lastSeenWhere(user.id, now), data: { lastSeenAt: now } })
  );
}
