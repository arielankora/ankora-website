"use server";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { domainErrorText } from "@/lib/i18n/domain-errors";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import {
  createCredential,
  deleteCredential,
  updateCredential,
  CredentialNotFoundError,
} from "@/lib/app-domain/credentials";
import { VaultUnavailableError, VaultKeyMismatchError } from "@/lib/vault/keys";

// Credentials vault, writes. None of these returns a stored value: the
// only way to read one back is the reveal route.

type FormState = { error?: string; ok?: boolean };

// The vault's own refusal when no key is set at all. Any other
// VaultUnavailableError message names a misconfigured setting for whoever
// runs the environment, and is shown as it is.
const VAULT_UNSET = new VaultUnavailableError().message;

async function friendlyError(err: unknown): Promise<string> {
  const t = await getTranslations("credentials.errors");
  if (err instanceof ForbiddenError) return t("forbidden");
  // CredentialNotFoundError and the field and link refusals are
  // DomainErrors (ADR 0006).
  const domain = await domainErrorText(err);
  if (domain) return domain;
  if (err instanceof CredentialNotFoundError) return err.message;
  if (err instanceof VaultKeyMismatchError) return t("vaultKeyMismatch");
  if (err instanceof VaultUnavailableError) return err.message === VAULT_UNSET ? t("vaultUnavailable") : err.message;
  if (err instanceof Error && /[֐-׿]/.test(err.message)) return err.message;
  return t("generic");
}

function str(formData: FormData, key: string): string | undefined {
  const v = formData.get(key);
  return typeof v === "string" ? v : undefined;
}

export async function createCredentialAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  try {
    await createCredential(user, {
      clientId: str(formData, "clientId") ?? "",
      systemName: str(formData, "systemName") ?? "",
      url: str(formData, "url"),
      username: str(formData, "username"),
      password: str(formData, "password"),
      notes: str(formData, "notes"),
    });
  } catch (err) {
    return { error: await friendlyError(err) };
  }
  revalidatePath("/app/credentials");
  return { ok: true };
}

export async function updateCredentialAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const clear = (["username", "password", "notes"] as const).filter((f) => formData.get(`clear_${f}`) === "on");
  try {
    await updateCredential(user, str(formData, "id") ?? "", {
      systemName: str(formData, "systemName"),
      url: str(formData, "url") ?? null,
      username: str(formData, "username"),
      password: str(formData, "password"),
      notes: str(formData, "notes"),
      clear,
    });
  } catch (err) {
    return { error: await friendlyError(err) };
  }
  revalidatePath("/app/credentials");
  return { ok: true };
}

export async function deleteCredentialAction(id: string): Promise<FormState> {
  const user = await requireUser();
  try {
    await deleteCredential(user, id);
  } catch (err) {
    return { error: await friendlyError(err) };
  }
  revalidatePath("/app/credentials");
  return { ok: true };
}
