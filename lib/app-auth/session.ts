import "server-only";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import type { User } from "@prisma/client";

// The single, authoritative "who is making this request, and are they
// still allowed to" check. Every protected Server Component / Route
// Handler / Server Action in app/(product)/app must call this rather than
// trusting the JWT alone - spec 4.1: "כל Endpoint בשרת בודק Authorization,"
// and spec 4.2's "logout all sessions" only actually works if something
// re-checks tokenVersion against the database on each request.
export async function getCurrentUser(): Promise<User | null> {
  const session = await auth();
  const sub = session?.user ? (session.user as any).id : null;
  if (!sub) return null;

  const user = await prisma.user.findUnique({ where: { id: sub } });
  if (!user || user.deletedAt) return null;
  if (user.status !== "ACTIVE") return null;

  const sessionTokenVersion = (session!.user as any).tokenVersion;
  if (typeof sessionTokenVersion === "number" && sessionTokenVersion !== user.tokenVersion) {
    // A "logout all sessions" happened after this JWT was issued.
    return null;
  }

  return user;
}

/// For Server Components/layouts: redirects to login if there's no valid,
/// still-active session. Returns the fresh DB user otherwise.
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/app/login");
  return user;
}

/// For Route Handlers/Server Actions, where a redirect isn't appropriate -
/// throw and let the caller map it to a 401 JSON response.
export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

export async function requireUserOrThrow(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}
