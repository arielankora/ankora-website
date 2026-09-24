"use server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireUser } from "@/lib/app-auth/session";
import { inviteUser, resendInvite, updateUserRoleStatus, setUserClientAccess, logoutAllSessions } from "@/lib/app-domain/users";
import { revokeClaudeGrantsForUser } from "@/lib/app-domain/mcp-connections";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import type { UserRole, UserStatus, ClientUserRole } from "@prisma/client";

// `ok` is what tells useActionForm the write landed, and it is the reason
// this state carries a flag that looks redundant beside `inviteLink`.
// The hook refreshes the screen behind the form on `ok === true`, and the
// users table is exactly the screen that has to show the new row while
// the drawer stays open on the one-time link.
type InviteState = {
  ok?: boolean;
  error?: string;
  inviteLink?: string;
  invitedName?: string;
  emailSent?: boolean;
};
type FormState = { error?: string; ok?: boolean };

function friendlyError(err: unknown): string {
  if (err instanceof ForbiddenError) return "אין לך הרשאה לבצע פעולה זו.";
  if (err instanceof Error) return err.message;
  return "אירעה שגיאה. נסו שוב.";
}

export async function inviteUserAction(_prev: InviteState | undefined, formData: FormData): Promise<InviteState> {
  const actor = await requireUser();
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const role = String(formData.get("role") || "") as UserRole;

  if (!name || !email || !role) return { error: "יש למלא שם, אימייל ותפקיד." };

  const clientIds = formData.getAll("clientIds").map(String).filter(Boolean);
  const clientUserRole = (String(formData.get("clientUserRole") || "") as ClientUserRole) || undefined;

  try {
    const { user, setPasswordToken, emailSent } = await inviteUser(actor, { name, email, role, clientIds, clientUserRole });
    revalidatePath("/app/users");

    // Portal phase 0: the invite email is sent by inviteUser itself. The
    // absolute link is still returned so the admin has a fallback when the
    // mail does not arrive (spam folder, wrong address, provider outage) -
    // the screen now says which of the two happened instead of claiming
    // there is no email provider.
    const hdrs = await headers();
    const host = hdrs.get("host");
    const protocol = host?.startsWith("localhost") || host?.startsWith("127.0.0.1") ? "http" : "https";
    const origin = host ? `${protocol}://${host}` : "";

    return {
      ok: true,
      invitedName: user.name,
      inviteLink: `${origin}/app/reset-password?token=${setPasswordToken}`,
      emailSent,
    };
  } catch (err) {
    return { error: friendlyError(err) };
  }
}

type ResendState = { error?: string; sent?: boolean; inviteLink?: string };

/// Resends an invite that was never used. Mirrors inviteUserAction's
/// contract: the absolute link comes back either way, so an admin whose
/// mail failed to send still has something to relay by hand rather than
/// a dead end.
export async function resendInviteAction(
  _prev: ResendState | undefined,
  formData: FormData
): Promise<ResendState> {
  const actor = await requireUser();
  const userId = String(formData.get("userId") || "");
  if (!userId) return { error: "משתמש לא נמצא." };

  try {
    const { setPasswordToken, emailSent } = await resendInvite(actor, userId);
    revalidatePath(`/app/users/${userId}`);
    revalidatePath("/app/users");

    const hdrs = await headers();
    const host = hdrs.get("host");
    const protocol = host?.startsWith("localhost") || host?.startsWith("127.0.0.1") ? "http" : "https";
    const origin = host ? `${protocol}://${host}` : "";

    return { sent: emailSent, inviteLink: `${origin}/app/reset-password?token=${setPasswordToken}` };
  } catch (err) {
    return { error: friendlyError(err) };
  }
}

export async function updateUserRoleStatusAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  const userId = String(formData.get("userId") || "");
  if (!userId) return { error: "משתמש לא נמצא." };

  try {
    await updateUserRoleStatus(actor, userId, {
      role: (String(formData.get("role") || "") as UserRole) || undefined,
      status: (String(formData.get("status") || "") as UserStatus) || undefined,
    });
  } catch (err) {
    return { error: friendlyError(err) };
  }

  revalidatePath("/app/users");
  revalidatePath(`/app/users/${userId}`);
  return { ok: true };
}

export async function setUserClientAccessAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  const userId = String(formData.get("userId") || "");
  if (!userId) return { error: "משתמש לא נמצא." };

  const clientIds = formData.getAll("clientIds").map(String).filter(Boolean);

  try {
    await setUserClientAccess(actor, userId, clientIds);
  } catch (err) {
    return { error: friendlyError(err) };
  }

  revalidatePath(`/app/users/${userId}`);
  return { ok: true };
}

export async function logoutAllSessionsAction(formData: FormData) {
  const actor = await requireUser();
  const userId = String(formData.get("userId") || "");
  if (!userId) return;

  await logoutAllSessions(actor, userId);
  revalidatePath(`/app/users/${userId}`);
}

/// Cuts a user's Claude access without touching their browser sessions.
///
/// Sits beside logoutAllSessionsAction rather than inside it: the two
/// answer different questions. "This account may be compromised" wants
/// every session gone, which bumping tokenVersion already does (and which
/// takes the Claude grants with it). "This person no longer needs the
/// integration" wants only the integration gone, and should not log them
/// out of the app they are working in.
export async function revokeClaudeGrantsAction(formData: FormData) {
  const actor = await requireUser();
  const userId = String(formData.get("userId") || "");
  if (!userId) return;

  await revokeClaudeGrantsForUser(actor, userId);
  revalidatePath(`/app/users/${userId}`);
}
