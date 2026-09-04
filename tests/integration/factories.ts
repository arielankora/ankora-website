import { prisma } from "./setup";
import { hashPassword } from "@/lib/app-auth/password";
import type { UserRole, UserStatus } from "@prisma/client";

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
