"use server";
import { revalidatePath } from "next/cache";
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

function friendlyError(err: unknown): string {
  if (err instanceof ForbiddenError) return "אין לך הרשאה לבצע פעולה זו.";
  if (err instanceof CredentialNotFoundError) return err.message;
  if (err instanceof VaultUnavailableError || err instanceof VaultKeyMismatchError) return err.message;
  if (err instanceof Error && /[֐-׿]/.test(err.message)) return err.message;
  return "אירעה שגיאה. נסו שוב.";
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
    return { error: friendlyError(err) };
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
    return { error: friendlyError(err) };
  }
  revalidatePath("/app/credentials");
  return { ok: true };
}

export async function deleteCredentialAction(id: string): Promise<FormState> {
  const user = await requireUser();
  try {
    await deleteCredential(user, id);
  } catch (err) {
    return { error: friendlyError(err) };
  }
  revalidatePath("/app/credentials");
  return { ok: true };
}
