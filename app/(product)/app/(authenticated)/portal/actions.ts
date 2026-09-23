"use server";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/app-auth/session";
import { recordAudit } from "@/lib/app-auth/audit";
import { assertCan, ForbiddenError } from "@/lib/app-auth/permissions";
import { isProductionBuild } from "@/lib/env";
import {
  updatePortalScheduleRecipients,
  PORTAL_CLIENT_COOKIE,
  PORTAL_COOKIE_OPTIONS,
  PORTAL_PREVIEW_COOKIE,
} from "@/lib/app-domain/client-portal";

type FormState = { error?: string; ok?: boolean };

function friendlyError(err: unknown): string {
  if (err instanceof ForbiddenError) return "אין לך הרשאה לבצע פעולה זו.";
  if (err instanceof Error) return err.message;
  return "אירעה שגיאה. נסו שוב.";
}

function parseEmailList(value: FormDataEntryValue | null): string[] {
  if (!value) return [];
  return String(value)
    .split(/[,\n]/)
    .map((e) => e.trim())
    .filter(Boolean);
}

// Spec 13's "Client Admin יכול לנהל recipients" - the write path a Client
// Admin actually hits from app/(product)/app/portal/history/page.tsx.
// updatePortalScheduleRecipients() itself re-checks ClientUserRole===ADMIN
// and that the schedule belongs to the caller's own client, so this action
// adds no authorization logic of its own beyond calling it.
export async function updatePortalRecipientsAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const scheduleId = String(formData.get("scheduleId") || "");
  if (!scheduleId) return { error: "חסר מזהה דוח מתוזמן." };

  const recipients = parseEmailList(formData.get("recipients"));
  if (recipients.length === 0) return { error: "יש להזין לפחות נמען אחד." };

  try {
    await updatePortalScheduleRecipients(user, scheduleId, recipients);
  } catch (err) {
    return { error: friendlyError(err) };
  }

  revalidatePath("/app/portal/history");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Portal phase 0: which client the portal is showing.
//
// Both actions below only ever WRITE A REQUEST into a cookie.
// resolvePortalClient re-checks that request against the caller's own
// memberships (or their client.view permission) on every call, so nothing
// here is an authorisation decision - see client-portal.ts's comment on
// PORTAL_CLIENT_COOKIE.
// ---------------------------------------------------------------------------

const PREVIEW_COOKIE_MAX_AGE_S = 60 * 60; // one hour: a preview is a look, not a mode to live in

/// Both cookies used to be written with path "/app". Widening the path
/// does not replace those: a browser holding one at "/app" and one at "/"
/// sends both, more specific first, and the stale one wins on exactly the
/// screens that matter. The client-selection cookie lives for a hundred
/// and eighty days, so "it expires eventually" is not an answer.
///
/// So every write and every clear removes the old pair explicitly first.
/// Harmless once nobody has one left; a month of quiet wrong answers if
/// it is skipped.
function clearLegacyPortalCookies(jar: Awaited<ReturnType<typeof cookies>>) {
  jar.delete({ name: PORTAL_PREVIEW_COOKIE, path: "/app" });
  jar.delete({ name: PORTAL_CLIENT_COOKIE, path: "/app" });
}

/// An Ankora manager opens a client's portal exactly as that client sees
/// it. Read-only by construction (assertPortalWritable), one hour, and
/// audited on entry - a manager stepping into a client's view is a thing
/// the audit log should be able to answer questions about later.
export async function startPortalPreviewAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  assertCan(user.role, "report.internal.view");

  const clientId = String(formData.get("clientId") || "");
  const client = await prisma.client.findFirst({ where: { id: clientId, deletedAt: null } });
  if (!client) return;

  const jar = await cookies();
  clearLegacyPortalCookies(jar);
  jar.set(PORTAL_PREVIEW_COOKIE, client.id, {
    ...PORTAL_COOKIE_OPTIONS,
    secure: isProductionBuild(),
    maxAge: PREVIEW_COOKIE_MAX_AGE_S,
  });

  await recordAudit({
    actorId: user.id,
    action: "portal.preview.start",
    entityType: "Client",
    entityId: client.id,
    after: { clientName: client.name },
  });

  redirect("/app/portal");
}

export async function exitPortalPreviewAction(): Promise<void> {
  await requireUser();
  const jar = await cookies();
  clearLegacyPortalCookies(jar);
  jar.delete(PORTAL_PREVIEW_COOKIE);
  redirect("/app/clients");
}

/// The switcher a portal user sees only when they belong to more than one
/// client. The membership check here is a fast fail for a wrong id; the
/// authoritative one is in resolvePortalClient, which picks only from the
/// caller's own list.
export async function switchPortalClientAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const clientId = String(formData.get("clientId") || "");

  const membership = await prisma.clientUser.findFirst({ where: { userId: user.id, clientId } });
  if (!membership) return;

  const jar = await cookies();
  clearLegacyPortalCookies(jar);
  jar.set(PORTAL_CLIENT_COOKIE, clientId, {
    ...PORTAL_COOKIE_OPTIONS,
    secure: isProductionBuild(),
    maxAge: 60 * 60 * 24 * 180,
  });

  redirect("/app/portal");
}
