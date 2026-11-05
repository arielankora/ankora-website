"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import { addAppPasswordConnection, disconnect, testConnection } from "@/lib/app-domain/connections";

// Client connections (ADR 0001 section 24, task cmvtivumj000pjs08q9qj4t67).
// The Google round trip goes through /api/connections/google; these are
// the rest.

type Result = { error?: string; ok?: string };

const fail = (err: unknown): Result => ({ error: err instanceof Error ? err.message : "אירעה שגיאה. נסו שוב." });

export async function addAppPasswordAction(_prev: Result | undefined, f: FormData): Promise<Result> {
  const user = await requireUser();
  const clientId = String(f.get("clientId") ?? "");
  try {
    await addAppPasswordConnection(user, {
      clientId,
      account: String(f.get("account") ?? ""),
      appPassword: String(f.get("appPassword") ?? ""),
      consentText: String(f.get("consentText") ?? ""),
    });
  } catch (err) {
    return fail(err);
  }
  revalidatePath(`/app/clients/${clientId}/connections`);
  return { ok: "החיבור נשמר. הסיסמה בכספת." };
}

export async function disconnectAction(clientId: string, id: string): Promise<Result> {
  const user = await requireUser();
  try {
    await disconnect(user, id);
  } catch (err) {
    return fail(err);
  }
  revalidatePath(`/app/clients/${clientId}/connections`);
  return { ok: "החיבור נותק, וההרשאה בוטלה." };
}

export async function testConnectionAction(id: string, folderId: string | null): Promise<Result> {
  const user = await requireUser();
  try {
    return { ok: await testConnection(user, id, { folderId }) };
  } catch (err) {
    return fail(err);
  }
}
