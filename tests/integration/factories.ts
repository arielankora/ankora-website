import { prisma } from "./setup";
import { hashPassword } from "@/lib/app-auth/password";
import type { UserRole, UserStatus, ClientUserRole } from "@prisma/client";

let counter = 0;
function unique(prefix: string) {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}

export async function createTestUser(overrides: {
  role: UserRole;
  status?: UserStatus;
  password?: string;
  email?: string;
} & Partial<{ tokenVersion: number; failedLoginAttempts: number; lockedUntil: Date | null }>) {
  const password = overrides.password ?? "Tr0ub4dor&Zebra";
  const passwordHash = await hashPassword(password);
  const email = overrides.email ?? `${unique("user")}@test.ankora.local`;

  const user = await prisma.user.create({
    data: {
      name: `Test User ${email}`,
      email,
      passwordHash,
      role: overrides.role,
      status: overrides.status ?? "ACTIVE",
      tokenVersion: overrides.tokenVersion ?? 0,
      failedLoginAttempts: overrides.failedLoginAttempts ?? 0,
      lockedUntil: overrides.lockedUntil ?? null,
    },
  });

  return { user, password };
}

export async function createTestClient(overrides: { name?: string } = {}) {
  return prisma.client.create({
    data: { name: overrides.name ?? `Test Client ${unique("client")}` },
  });
}

export async function createTestCategory(overrides: { clientId?: string | null; name?: string } = {}) {
  return prisma.category.create({
    data: {
      name: overrides.name ?? `Test Category ${unique("category")}`,
      visibility: overrides.clientId ? "CLIENT" : "GLOBAL",
      clientId: overrides.clientId ?? null,
    },
  });
}

/// Phase 2: directly inserts a TimeEntry, bypassing lib/app-domain/time-entries.ts's
/// business rules - for tests that need to seed a specific pre-existing entry
/// (e.g. an old one to test the self-edit window) rather than exercise the
/// create flow itself.
export async function createTestTimeEntry(overrides: {
  userId: string;
  clientId: string;
  categoryId: string;
  startAt?: Date;
  endAt?: Date | null;
  source?: "MANUAL" | "TIMER";
  isManual?: boolean;
}) {
  const startAt = overrides.startAt ?? new Date();
  const endAt = overrides.endAt === undefined ? new Date(startAt.getTime() + 3600_000) : overrides.endAt;
  return prisma.timeEntry.create({
    data: {
      userId: overrides.userId,
      clientId: overrides.clientId,
      categoryId: overrides.categoryId,
      startAt,
      endAt,
      actualSeconds: endAt ? Math.round((endAt.getTime() - startAt.getTime()) / 1000) : null,
      billableSeconds: endAt ? Math.round((endAt.getTime() - startAt.getTime()) / 1000) : null,
      source: overrides.source ?? "MANUAL",
      isManual: overrides.isManual ?? true,
    },
  });
}

/// Phase 6: creates a CLIENT_USER (the User row) plus its ClientUser
/// membership row (the thing resolvePortalClient actually reads) in one
/// call - every portal integration test needs both, since a CLIENT_USER
/// with no ClientUser row is a valid-but-unassigned account (spec 21.2's
/// isolation guarantee starts from "no membership => ForbiddenError", not
/// "any client").
export async function createTestClientUser(overrides: { clientId: string; role?: ClientUserRole; email?: string }) {
  const { user, password } = await createTestUser({ role: "CLIENT_USER", email: overrides.email });
  const clientUser = await prisma.clientUser.create({
    data: { clientId: overrides.clientId, userId: user.id, role: overrides.role ?? "VIEWER" },
  });
  return { user, password, clientUser };
}
