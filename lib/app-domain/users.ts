import "server-only";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { assertCan } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { hashPassword } from "@/lib/app-auth/password";
import type { User, UserRole, UserStatus, ClientUserRole } from "@prisma/client";

// Phase 4 (Alerts/email delivery) hasn't been built yet, so there is no
// email provider to send invite/reset links through. Documented
// limitation (see docs/adr/0001, section "known limitations"): Phase 1
// surfaces the one-time link directly to the inviting admin to relay
// manually, instead of silently pretending email delivery exists.
const RESET_TOKEN_TTL_MS = 48 * 60 * 60 * 1000; // 48h for an initial invite/reset link

function generateResetToken() {
  const raw = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(raw).digest("hex");
  return { raw, tokenHash };
}

export async function listUsers() {
  return prisma.user.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: { clientAccess: { include: { client: true } } },
  });
}

export async function inviteUser(
  actor: User,
  input: {
    name: string;
    email: string;
    role: UserRole;
    clientIds?: string[];
    /// Phase 6: only meaningful when role === "CLIENT_USER" - see below.
    clientUserRole?: ClientUserRole;
  }
) {
  assertCan(actor.role, "user.manage");

  const email = input.email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new Error("A user with this email already exists.");

  // Phase 6: a CLIENT_USER is scoped by ClientUser membership (their
  // Client Portal - lib/app-domain/client-portal.ts's resolvePortalClient
  // is the only reader of this table), never by UserClientAccess (which
  // scopes an ANKORA_EMPLOYEE/ADMIN's time-reporting access to clients -
  // a different relationship entirely). Without this branch, inviting a
  // CLIENT_USER created a User row with no ClientUser membership at all,
  // and resolvePortalClient would permanently reject them with
  // "No active client membership" - the Client Portal would be built but
  // unreachable for every real client. Exactly one client is required
  // (spec 13 models one portal user -> one client for the MVP, see the
  // ADR addendum's resolvePortalClient note) - clientIds[1+] is ignored.
  if (input.role === "CLIENT_USER" && (!input.clientIds || input.clientIds.length === 0)) {
    throw new Error("יש לבחור לקוח עבור משתמש בתפקיד לקוח.");
  }

  // Placeholder hash for an account with no usable password yet - nobody
  // can log in with it (verifyPassword will just return false against any
  // guess) until the invite link is used to set a real one.
  const placeholder = await hashPassword(crypto.randomBytes(24).toString("hex"));

  const user = await prisma.user.create({
    data: {
      name: input.name.trim(),
      email,
      role: input.role,
      status: "INVITED",
      passwordHash: placeholder,
      clientAccess:
        input.role !== "CLIENT_USER" && input.clientIds?.length
          ? { create: input.clientIds.map((clientId) => ({ clientId })) }
          : undefined,
      clientMemberships:
        input.role === "CLIENT_USER" && input.clientIds?.length
          ? { create: [{ clientId: input.clientIds[0], role: input.clientUserRole ?? "VIEWER" }] }
          : undefined,
    },
  });

  const { raw, tokenHash } = generateResetToken();
  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
  });

  await recordAudit({
    actorId: actor.id,
    action: "user.invite",
    entityType: "User",
    entityId: user.id,
    after: { name: user.name, email: user.email, role: user.role },
  });

  return { user, setPasswordToken: raw };
}

export async function updateUserRoleStatus(
  actor: User,
  userId: string,
  input: { role?: UserRole; status?: UserStatus }
) {
  assertCan(actor.role, "user.manage");
  const before = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      role: input.role,
      status: input.status,
      // Suspending/archiving must kill any live sessions immediately -
      // otherwise a JWT issued before the suspension keeps working until
      // it naturally expires. Only bump on an actual status change.
      tokenVersion:
        input.status && input.status !== "ACTIVE" && input.status !== before.status
          ? { increment: 1 }
          : undefined,
    },
  });

  await recordAudit({
    actorId: actor.id,
    action: "user.role_status_change",
    entityType: "User",
    entityId: userId,
    before: { role: before.role, status: before.status },
    after: { role: user.role, status: user.status },
  });

  return user;
}

export async function setUserClientAccess(actor: User, userId: string, clientIds: string[]) {
  assertCan(actor.role, "user.manage");
  const before = await prisma.userClientAccess.findMany({ where: { userId }, select: { clientId: true } });

  await prisma.$transaction([
    prisma.userClientAccess.deleteMany({ where: { userId } }),
    prisma.userClientAccess.createMany({
      data: clientIds.map((clientId) => ({ userId, clientId })),
      skipDuplicates: true,
    }),
  ]);

  await recordAudit({
    actorId: actor.id,
    action: "user.client_access_change",
    entityType: "User",
    entityId: userId,
    before: before.map((b) => b.clientId),
    after: clientIds,
  });
}

/// Spec 4.2: "logout all sessions לאדמין" - invalidates every JWT already
/// issued for this user by bumping tokenVersion, checked on every request
/// in lib/app-auth/session.ts.
export async function logoutAllSessions(actor: User, userId: string) {
  assertCan(actor.role, "user.manage");
  await prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
  await recordAudit({ actorId: actor.id, action: "user.logout_all_sessions", entityType: "User", entityId: userId });
}
