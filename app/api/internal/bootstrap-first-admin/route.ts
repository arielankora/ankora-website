import { NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/app-auth/password";
import { recordAudit } from "@/lib/app-auth/audit";

export const dynamic = "force-dynamic";

// TEMPORARY, ONE-TIME BOOTSTRAP ROUTE.
//
// Production has no seeded users (see README.md: demo fixtures are
// Preview-only, and there is no self-service signup - every user is
// created via an existing admin's invite). This means there was no way
// for Ariel to log in to Production at all. He explicitly asked
// (2026-09-05) for a SUPER_ADMIN account at ariel@ankora.co.il to be
// created directly.
//
// This route exists ONLY to create that first account safely, without
// anyone (including Claude) ever seeing or choosing Ariel's actual
// password - it mirrors lib/app-domain/users.ts's real inviteUser() flow
// exactly (placeholder passwordHash nobody can log in with + a one-time
// reset-token link Ariel uses to set his own password), rather than
// inventing a separate, less-audited path.
//
// Self-disabling by design: it refuses to run a second time once any
// SUPER_ADMIN exists, so it cannot be replayed or abused after this
// commit is reverted (which happens immediately after a single
// successful call - see the follow-up revert commit).
const BOOTSTRAP_EMAIL = "ariel@ankora.co.il";
const RESET_TOKEN_TTL_MS = 48 * 60 * 60 * 1000; // 48h, same as a normal invite link

export async function POST() {
  const existingSuperAdminCount = await prisma.user.count({
    where: { role: "SUPER_ADMIN", deletedAt: null },
  });
  if (existingSuperAdminCount > 0) {
    return NextResponse.json(
      { error: "A Super Admin already exists. This one-time bootstrap route is disabled." },
      { status: 409 }
    );
  }

  const existing = await prisma.user.findUnique({ where: { email: BOOTSTRAP_EMAIL } });
  if (existing) {
    return NextResponse.json({ error: "A user with this email already exists." }, { status: 409 });
  }

  const placeholder = await hashPassword(crypto.randomBytes(24).toString("hex"));
  const user = await prisma.user.create({
    data: {
      name: "Ariel",
      email: BOOTSTRAP_EMAIL,
      role: "SUPER_ADMIN",
      status: "INVITED",
      passwordHash: placeholder,
    },
  });

  const raw = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(raw).digest("hex");
  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
  });

  await recordAudit({
    actorId: null,
    action: "user.bootstrap_invite",
    entityType: "User",
    entityId: user.id,
    after: { name: user.name, email: user.email, role: user.role },
  });

  return NextResponse.json({ resetUrl: `https://ankora.co.il/app/reset-password?token=${raw}` });
}
