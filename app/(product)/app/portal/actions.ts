"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { updatePortalScheduleRecipients } from "@/lib/app-domain/client-portal";

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
