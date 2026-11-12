"use server";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { domainErrorText } from "@/lib/i18n/domain-errors";
import { requireUser } from "@/lib/app-auth/session";
import { addAppPasswordConnection, disconnect, testConnection } from "@/lib/app-domain/connections";

// Client connections (ADR 0001 section 24, task cmvtivumj000pjs08q9qj4t67).
// The Google round trip goes through /api/connections/google; these are
// the rest.

type Result = { error?: string; ok?: string };

/// ADR 0006: a refusal in the reader's language. A DomainError is worded
/// from its code; anything else keeps its message, as before.
async function fail(err: unknown): Promise<Result> {
  const domain = await domainErrorText(err);
  if (domain) return { error: domain };
  if (err instanceof Error) return { error: err.message };
  return { error: (await getTranslations("clients.connections.result"))("generic") };
}

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
    return await fail(err);
  }
  revalidatePath(`/app/clients/${clientId}/connections`);
  return { ok: (await getTranslations("clients.connections.result"))("saved") };
}

export async function disconnectAction(clientId: string, id: string): Promise<Result> {
  const user = await requireUser();
  try {
    await disconnect(user, id);
  } catch (err) {
    return await fail(err);
  }
  revalidatePath(`/app/clients/${clientId}/connections`);
  return { ok: (await getTranslations("clients.connections.result"))("disconnected") };
}

export async function testConnectionAction(id: string, folderId: string | null): Promise<Result> {
  const user = await requireUser();
  try {
    const r = await testConnection(user, id, { folderId });
    const t = await getTranslations("clients.connections.result");
    if (r.kind === "appPassword") return { ok: t("appPasswordNotTestable") };
    if (r.kind === "sent") return { ok: t("testSent", { account: r.account }) };
    const mail = t("mailConnected", { threads: r.threads === null ? "?" : String(r.threads) });
    return { ok: r.driveFiles === null ? t("mailOnly", { mail }) : t("mailAndDrive", { mail, drive: t("driveFiles", { count: String(r.driveFiles) }) }) };
  } catch (err) {
    return await fail(err);
  }
}
