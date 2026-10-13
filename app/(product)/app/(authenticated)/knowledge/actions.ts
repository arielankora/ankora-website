"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { approveProposal, rejectProposal } from "@/lib/app-domain/knowledge-proposals";

// Org brain, phase 2: "ממתין לאישור" (spec 5.2). Approve, edit and
// approve, reject with a reason. Nothing else writes a proposal into a
// client file.

type FormState = { error?: string; ok?: boolean };

/// The fields a person may change before approving. Anything else on the
/// form is ignored rather than trusted.
const EDITABLE = new Set([
  "body",
  "name",
  "role",
  "context",
  "systemName",
  "purpose",
  "blocker",
  "notes",
  "accessStatus",
  "knowledgeStatus",
  "toResolve",
  "validUntil",
  "validUntilEvent",
  "decidedAt",
  "decidedBy",
]);

function friendlyError(err: unknown): string {
  if (err instanceof ForbiddenError) return "אין לך הרשאה לפעולה זו - הלקוח אינו משויך אליך.";
  if (err instanceof Error) return err.message;
  return "אירעה שגיאה. נסו שוב.";
}

function done(): FormState {
  revalidatePath("/app/knowledge");
  revalidatePath("/app", "layout");
  return { ok: true };
}

export async function approveProposalAction(id: string): Promise<FormState> {
  const user = await requireUser();
  try {
    await approveProposal(user, id);
  } catch (err) {
    return { error: friendlyError(err) };
  }
  return done();
}

export async function approveEditedProposalAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const edits: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (!EDITABLE.has(key)) continue;
    const v = String(value).trim();
    // A choice left empty is no change, not a cleared value.
    if (!v && (key === "knowledgeStatus" || key === "accessStatus")) continue;
    edits[key] = v || null;
  }
  try {
    await approveProposal(user, String(formData.get("id") ?? ""), edits);
  } catch (err) {
    return { error: friendlyError(err) };
  }
  return done();
}

export async function rejectProposalAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  try {
    await rejectProposal(user, String(formData.get("id") ?? ""), String(formData.get("reason") ?? ""));
  } catch (err) {
    return { error: friendlyError(err) };
  }
  return done();
}
