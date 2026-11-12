"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/app-auth/session";
import {
  changeOwnPassword,
  updateOwnTimezone,
  updateOwnName,
  updateOwnLocale,
  updateOwnWhatsappNumber,
  updateLongRunningTimerEmailPreference,
  updateDailyDigestPreference,
  ProfileError,
  type ProfileErrorCode,
} from "@/lib/app-domain/profile";
import { PASSWORD_MIN_LENGTH } from "@/lib/app-auth/password";
import { APP_LOCALE_COOKIE, APP_LOCALE_COOKIE_MAX_AGE } from "@/lib/i18n/config";

type FormState = { error?: string; ok?: boolean };
type ToggleState = { ok: true } | { ok: false; error: string };

/// ADR 0006: a refusal from the domain is shown by its code, in the
/// person's language. Anything else is a fault, and says so without
/// repeating an internal message to the screen.
async function errorMessage(err: unknown): Promise<string> {
  const t = await getTranslations("profile.errors");
  return err instanceof ProfileError ? profileErrorText(t, err.code) : t("generic");
}

function profileErrorText(t: Awaited<ReturnType<typeof getTranslations<"profile.errors">>>, code: ProfileErrorCode): string {
  return code === "password_too_short" ? t(code, { min: PASSWORD_MIN_LENGTH }) : t(code);
}

export async function changePasswordAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const t = await getTranslations("profile.errors");
  const currentPassword = String(formData.get("currentPassword") || "");
  const newPassword = String(formData.get("newPassword") || "");
  const confirmPassword = String(formData.get("confirmPassword") || "");

  if (!currentPassword || !newPassword) return { error: t("allFieldsRequired") };
  if (newPassword !== confirmPassword) return { error: t("confirmMismatch") };

  const result = await changeOwnPassword(user, currentPassword, newPassword);
  if (!result.ok) return { error: profileErrorText(t, result.code) };

  // Password change invalidates every session, including this one (spec
  // 4.2's "logout all sessions" semantics - see profile.ts's comment).
  // Redirect straight to login rather than leaving the user on a page
  // whose session is already dead server-side.
  redirect("/app/login?passwordChanged=1");
}

export async function updateTimezoneAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const timezone = String(formData.get("timezone") || "");

  try {
    await updateOwnTimezone(user, timezone);
  } catch (err) {
    return { error: await errorMessage(err) };
  }

  revalidatePath("/app/profile");
  return { ok: true };
}

/// ADR 0006: the interface language. The whole app changes with it, down
/// to the direction of the page, so LanguageForm reloads the page on
/// success rather than refreshing one screen. The cookie remembers the
/// choice on this browser for the screens before sign-in; the user's row
/// stays the source of truth everywhere a user is known.
export async function updateLocaleAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const requested = String(formData.get("locale") || "");

  let locale;
  try {
    locale = await updateOwnLocale(user, requested);
  } catch (err) {
    return { error: await errorMessage(err) };
  }

  (await cookies()).set(APP_LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: APP_LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
  });
  return { ok: true };
}

export async function updateNameAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const name = String(formData.get("name") || "");

  try {
    await updateOwnName(user, name);
  } catch (err) {
    return { error: await errorMessage(err) };
  }

  revalidatePath("/app/profile");
  return { ok: true };
}

export async function updateWhatsappNumberAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const whatsappNumber = String(formData.get("whatsappNumber") || "");

  try {
    await updateOwnWhatsappNumber(user, whatsappNumber);
  } catch (err) {
    return { error: await errorMessage(err) };
  }

  revalidatePath("/app/profile");
  return { ok: true };
}

// App redesign, Profile screen (screen 18): a Switch-driven toggle (see
// ScheduleActions.tsx/RuleActions.tsx for the same optimistic-toggle +
// toast pattern this mirrors) rather than a useFormState form - a single
// on/off preference reads more like the report-schedule/alert-rule
// switches elsewhere in the app than like a form submission.
export async function updateNotificationPreferenceAction(enabled: boolean): Promise<ToggleState> {
  const user = await requireUser();
  try {
    await updateLongRunningTimerEmailPreference(user, enabled);
    revalidatePath("/app/profile");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: await errorMessage(err) };
  }
}

export async function updateDailyDigestPreferenceAction(enabled: boolean): Promise<ToggleState> {
  const user = await requireUser();
  try {
    await updateDailyDigestPreference(user, enabled);
    revalidatePath("/app/profile");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: await errorMessage(err) };
  }
}

/// Credentials vault, phase 1a: remove one of my own passkeys. Adding one
/// goes through the JSON routes under /api/passkeys, because the browser
/// has to sign a challenge in between.
export async function removePasskeyAction(id: string): Promise<FormState> {
  const user = await requireUser();
  const { removeMyPasskey, PasskeyError } = await import("@/lib/app-auth/passkeys");
  try {
    await removeMyPasskey(user, id);
  } catch (err) {
    if (err instanceof PasskeyError) return { error: err.message };
    return { error: "אירעה שגיאה. נסו שוב." };
  }
  revalidatePath("/app/profile");
  return { ok: true };
}

/// A client's "ask for a passkey at every sign-in" (lib/app-auth/second-factor.ts).
export async function setLoginPasskeyRequiredAction(enabled: boolean, password: string): Promise<FormState> {
  const user = await requireUser();
  const { setOwnLoginPasskeyRequired, SecondFactorError } = await import("@/lib/app-auth/second-factor");
  const { StepUpFailedError, StepUpLockedError } = await import("@/lib/app-auth/step-up");
  try {
    await setOwnLoginPasskeyRequired(user, Boolean(enabled), String(password ?? ""));
  } catch (err) {
    if (err instanceof SecondFactorError || err instanceof StepUpFailedError || err instanceof StepUpLockedError) {
      return { error: err.message };
    }
    return { error: "אירעה שגיאה. נסו שוב." };
  }
  revalidatePath("/app/profile");
  return { ok: true };
}

// ── Add a device (lib/app-auth/device-link.ts) ────────────────────────

export async function deviceLinkOptionsAction(): Promise<{ ok: true; options: unknown } | { ok: false; error: string }> {
  const user = await requireUser();
  const { headers } = await import("next/headers");
  const { relyingPartyFor, PasskeyError } = await import("@/lib/app-auth/passkeys");
  const { StepUpLockedError } = await import("@/lib/app-auth/step-up");
  const { deviceLinkOptions } = await import("@/lib/app-auth/device-link");
  try {
    return { ok: true, options: await deviceLinkOptions(user, relyingPartyFor(await headers())) };
  } catch (err) {
    if (err instanceof PasskeyError || err instanceof StepUpLockedError) return { ok: false, error: err.message };
    throw err;
  }
}

export async function deviceLinkIssueAction(
  response: unknown,
): Promise<{ ok: true; code: string; expiresAt: string } | { ok: false; error: string }> {
  const user = await requireUser();
  const { headers } = await import("next/headers");
  const { relyingPartyFor, PasskeyError } = await import("@/lib/app-auth/passkeys");
  const { StepUpFailedError, StepUpLockedError } = await import("@/lib/app-auth/step-up");
  const { issueDeviceLinkCode } = await import("@/lib/app-auth/device-link");
  try {
    const { code, expiresAt } = await issueDeviceLinkCode(user, response as any, relyingPartyFor(await headers()));
    return { ok: true, code, expiresAt: expiresAt.toISOString() };
  } catch (err) {
    if (err instanceof StepUpFailedError) return { ok: false, error: "האימות נכשל." };
    if (err instanceof PasskeyError || err instanceof StepUpLockedError) return { ok: false, error: err.message };
    throw err;
  }
}

