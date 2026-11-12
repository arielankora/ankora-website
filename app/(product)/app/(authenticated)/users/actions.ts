"use server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { domainErrorText } from "@/lib/i18n/domain-errors";
import { requireUser } from "@/lib/app-auth/session";
import {
  inviteUser,
  resendInvite,
  updateUserRoleStatus,
  setUserClientAccess,
  logoutAllSessions,
  setUserPersonalEmail,
} from "@/lib/app-domain/users";
import {
  dismissPdfUpload,
  issueDeletionDeclarationLink,
  pendingPdfUploads,
  recordPdfSignatureFromDocument,
} from "@/lib/app-domain/agreements";
import { CURRENT_AGREEMENTS } from "@/lib/agreements";
import { localDateTimeToUtc } from "@/lib/timezone";
import { revokeClaudeGrantsForUser } from "@/lib/app-domain/mcp-connections";
import { setUserCanApproveExceptions } from "@/lib/app-domain/rule-approvals";
import { setCommsAccess } from "@/lib/app-domain/comms-access";
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

async function errorsT() {
  return getTranslations("users.errors");
}

async function errorText(key: "missingFields" | "userNotFound" | "fileNotFound" | "checkFileFirst" | "signedDateRequired" | "alreadyHandled" | "reasonRequired") {
  const t = await errorsT();
  return t(key);
}

async function friendlyError(err: unknown): Promise<string> {
  const t = await errorsT();
  if (err instanceof ForbiddenError) return t("forbidden");
  const domain = await domainErrorText(err);
  if (domain) return domain;
  if (err instanceof Error) return err.message;
  return t("generic");
}

export async function inviteUserAction(_prev: InviteState | undefined, formData: FormData): Promise<InviteState> {
  const actor = await requireUser();
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const role = String(formData.get("role") || "") as UserRole;

  if (!name || !email || !role) return { error: await errorText("missingFields") };

  const clientIds = formData.getAll("clientIds").map(String).filter(Boolean);
  const clientUserRole = (String(formData.get("clientUserRole") || "") as ClientUserRole) || undefined;
  const personalEmail = String(formData.get("personalEmail") || "");

  try {
    const { user, setPasswordToken, emailSent } = await inviteUser(actor, {
      name,
      email,
      role,
      clientIds,
      clientUserRole,
      personalEmail,
    });
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
    return { error: await friendlyError(err) };
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
  if (!userId) return { error: await errorText("userNotFound") };

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
    return { error: await friendlyError(err) };
  }
}

/// Returns the role and status as saved, so the form can show them from
/// the action's own answer. Waiting for the revalidated page to bring new
/// props was not enough: React 19 resets the form after the action, and
/// on the preview of PR #212 that reset left the selects on the values
/// from before the save while the screen said "נשמר".
type RoleStatusState = FormState & { saved?: { role: UserRole; status: UserStatus } };

export async function updateUserRoleStatusAction(
  _prev: RoleStatusState | undefined,
  formData: FormData
): Promise<RoleStatusState> {
  const actor = await requireUser();
  const userId = String(formData.get("userId") || "");
  if (!userId) return { error: await errorText("userNotFound") };

  let saved: { role: UserRole; status: UserStatus };
  try {
    const user = await updateUserRoleStatus(actor, userId, {
      role: (String(formData.get("role") || "") as UserRole) || undefined,
      status: (String(formData.get("status") || "") as UserStatus) || undefined,
    });
    saved = { role: user.role, status: user.status };
  } catch (err) {
    return { error: await friendlyError(err) };
  }

  revalidatePath("/app/users");
  revalidatePath(`/app/users/${userId}`);
  return { ok: true, saved };
}

export async function setUserClientAccessAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  const userId = String(formData.get("userId") || "");
  if (!userId) return { error: await errorText("userNotFound") };

  const clientIds = formData.getAll("clientIds").map(String).filter(Boolean);

  try {
    await setUserClientAccess(actor, userId, clientIds);
  } catch (err) {
    return { error: await friendlyError(err) };
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

/// After a lost device: clears the person's passkeys and logs them out
/// everywhere. They enrol a new passkey at their next sign-in, right after
/// their password (lib/app-auth/second-factor.ts).
export async function resetPasskeysAction(formData: FormData) {
  const actor = await requireUser();
  const userId = String(formData.get("userId") || "");
  if (!userId) return;
  const { resetPasskeysByAdmin } = await import("@/lib/app-auth/passkeys");
  await resetPasskeysByAdmin(actor, userId);
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

/// DPA section 4: the credentials a person revealed in the last 90 days,
/// grouped by client, with a message per client ready to copy. Behind a
/// button rather than on page load, because producing it is audited and
/// opening a user's page is not a reason to.
export type ExposureReportView =
  | {
      ok: true;
      userName: string;
      since: string;
      until: string;
      clients: {
        clientId: string;
        clientName: string;
        items: { credentialId: string; systemName: string; revealCount: number; lastRevealedAt: string; deleted: boolean }[];
        message: string;
      }[];
    }
  | { ok: false; error: string };

export async function credentialExposureReportAction(userId: string): Promise<ExposureReportView> {
  const user = await requireUser();
  const { credentialExposureReport, exposureMessageFor } = await import("@/lib/app-domain/credential-exposure");
  try {
    const report = await credentialExposureReport(user, userId);
    return {
      ok: true,
      userName: report.user.name,
      since: report.since.toISOString(),
      until: report.until.toISOString(),
      clients: report.clients.map((g) => ({
        clientId: g.clientId,
        clientName: g.clientName,
        items: g.items.map((i) => ({ ...i, lastRevealedAt: i.lastRevealedAt.toISOString() })),
        message: exposureMessageFor(report, g),
      })),
    };
  } catch (err) {
    return { ok: false, error: await friendlyError(err) };
  }
}

/// Org brain, phase 3 (decision 5): "אישור חריגות ומידע רגיש", given to a
/// person rather than a role.
export async function setExceptionApproverAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  const userId = String(formData.get("userId") || "");
  if (!userId) return { error: await errorText("userNotFound") };
  try {
    await setUserCanApproveExceptions(actor, userId, formData.get("canApproveExceptions") === "on");
  } catch (err) {
    return { error: await friendlyError(err) };
  }
  revalidatePath(`/app/users/${userId}`);
  return { ok: true };
}

/// The communications screen: level and Aloha lines, from the person's page.
export async function setCommsAccessAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  const userId = String(formData.get("userId") || "");
  if (!userId) return { error: await errorText("userNotFound") };
  try {
    await setCommsAccess(actor, userId, {
      level: String(formData.get("level") || "NONE"),
      lines: formData.getAll("line").map(String).filter(Boolean),
    });
  } catch (err) {
    return { error: await friendlyError(err) };
  }
  revalidatePath(`/app/users/${userId}`);
  return { ok: true };
}

/// Employee agreements: the private address on the user's page.
export async function setPersonalEmailAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  const userId = String(formData.get("userId") || "");
  if (!userId) return { error: await errorText("userNotFound") };
  try {
    await setUserPersonalEmail(actor, userId, String(formData.get("personalEmail") || ""));
  } catch (err) {
    return { error: await friendlyError(err) };
  }
  revalidatePath(`/app/users/${userId}`);
  return { ok: true };
}

type DeletionLinkState = { error?: string; sent?: boolean; link?: string };

/// Sends the deletion declaration link to the person's private address.
/// Normally for someone already suspended; for anyone still active the
/// form asks for an explicit confirmation, which the domain checks.
/// The link comes back either way, so the admin can relay it by hand when
/// the mail does not arrive, as with an invite.
export async function issueDeletionDeclarationAction(
  _prev: DeletionLinkState | undefined,
  formData: FormData
): Promise<DeletionLinkState> {
  const actor = await requireUser();
  const userId = String(formData.get("userId") || "");
  if (!userId) return { error: await errorText("userNotFound") };
  try {
    const { url, emailSent } = await issueDeletionDeclarationLink(actor, userId, {
      confirmActive: formData.get("confirm") === "on",
    });
    revalidatePath(`/app/users/${userId}`);
    return { sent: emailSent, link: url };
  } catch (err) {
    return { error: await friendlyError(err) };
  }
}

/// A signed PDF the employee uploaded, checked by a person on the user's
/// page (5.11.2026). Before this, the approvals screen sent the admin to
/// this page with nothing on it to act on, and the only way to record the
/// upload was to ask Claude. Same domain calls as the MCP tools, so the
/// same rules hold: only the current version, only a document on the
/// internal client, and the lifecycle task hears about it.
async function pendingUploadOf(userId: string, documentId: string) {
  const pending = await pendingPdfUploads(userId);
  for (const kind of Object.keys(pending) as (keyof typeof pending)[]) {
    if (pending[kind].some((p) => p.documentId === documentId)) return kind;
  }
  return null;
}

export async function recordPdfUploadAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  const userId = String(formData.get("userId") || "");
  const documentId = String(formData.get("documentId") || "");
  if (!userId || !documentId) return { error: await errorText("fileNotFound") };
  const checked = formData.get("checked") === "on";
  if (!checked) return { error: await errorText("checkFileFirst") };
  const date = String(formData.get("signedAt") || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: await errorText("signedDateRequired") };
  try {
    const kind = await pendingUploadOf(userId, documentId);
    if (!kind) return { error: await errorText("alreadyHandled") };
    await recordPdfSignatureFromDocument(actor, {
      userId,
      kind,
      version: CURRENT_AGREEMENTS[kind],
      signedName: String(formData.get("signedName") || ""),
      signedAt: localDateTimeToUtc(date, "00:00"),
      documentId,
    });
  } catch (err) {
    return { error: await friendlyError(err) };
  }
  revalidatePath(`/app/users/${userId}`);
  revalidatePath("/app/approvals");
  return { ok: true };
}

export async function dismissPdfUploadAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  const userId = String(formData.get("userId") || "");
  const documentId = String(formData.get("documentId") || "");
  if (!userId || !documentId) return { error: await errorText("fileNotFound") };
  const reason = String(formData.get("reason") || "").trim();
  if (!reason) return { error: await errorText("reasonRequired") };
  try {
    if (!(await pendingUploadOf(userId, documentId))) return { error: await errorText("alreadyHandled") };
    await dismissPdfUpload(actor, documentId, reason);
  } catch (err) {
    return { error: await friendlyError(err) };
  }
  revalidatePath(`/app/users/${userId}`);
  revalidatePath("/app/approvals");
  return { ok: true };
}
