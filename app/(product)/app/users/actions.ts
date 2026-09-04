"use server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireUser } from "@/lib/app-auth/session";
import { inviteUser, updateUserRoleStatus, setUserClientAccess, logoutAllSessions } from "@/lib/app-domain/users";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import type { UserRole, UserStatus } from "@prisma/client";

type InviteState = { error?: string; inviteLink?: string; invitedName?: string };
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

  try {
    const { user, setPasswordToken } = await inviteUser(actor, { name, email, role, clientIds });
    revalidatePath("/app/users");

    // Spec's documented Phase 1 limitation (no email provider until
    // Phase 4): the one-time link is surfaced to the inviting admin to
    // relay manually, rather than silently claiming an email was sent.
    // Built as an absolute URL (not a relative path) since the admin will
    // typically copy/paste this into Slack or a separate email to the
    // invited user, outside the app itself.
    const hdrs = headers();
    const host = hdrs.get("host");
    const protocol = host?.startsWith("localhost") || host?.startsWith("127.0.0.1") ? "http" : "https";
    const origin = host ? `${protocol}://${host}` : "";

    return {
      invitedName: user.name,
      inviteLink: `${origin}/app/reset-password?token=${setPasswordToken}`,
    };
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
