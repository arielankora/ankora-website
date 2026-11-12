"use client";
import { useFormState, useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { changePasswordAction } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  const t = useTranslations("profile.password");
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-1 w-full rounded-full border border-gold/40 px-5 py-2.5 text-sm font-medium text-app-text-accent disabled:opacity-50"
    >
      {pending ? t("submitting") : t("submit")}
    </button>
  );
}

// App redesign (handoff README, screen 18): the prototype's "סיסמה" card
// shows an "עודכנה לפני 3 חודשים" example line - that exact string is a
// mockup placeholder, not a real value, so `lastChangedLabel` (computed in
// page.tsx from lib/app-domain/profile.ts's getLastPasswordChangeAt, which
// reads the real audit trail) is passed in and rendered instead of any
// hardcoded text; null renders no line at all rather than guessing.
/// `minLength` comes from the server page: the policy lives beside the
/// password hashing, which has no business in a browser bundle.
export function ChangePasswordForm({ lastChangedLabel, minLength }: { lastChangedLabel: string | null; minLength: number }) {
  const [state, formAction] = useFormState(changePasswordAction, {});
  const t = useTranslations("profile.password");

  return (
    <div>
      {lastChangedLabel && <p className="mb-4 text-xs text-app-text-tertiary">{lastChangedLabel}</p>}

      <form action={formAction} className="space-y-3">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-app-text-secondary">{t("current")}</span>
          <input
            type="password"
            name="currentPassword"
            required
            autoComplete="current-password"
            className="w-full rounded-lg border border-app-border-strong bg-white px-3.5 py-2.5 text-sm text-app-text-primary outline-none focus:border-gold"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-app-text-secondary">{t("new")}</span>
          <input
            type="password"
            name="newPassword"
            required
            autoComplete="new-password"
            className="w-full rounded-lg border border-app-border-strong bg-white px-3.5 py-2.5 text-sm text-app-text-primary outline-none focus:border-gold"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-app-text-secondary">{t("confirm")}</span>
          <input
            type="password"
            name="confirmPassword"
            required
            autoComplete="new-password"
            className="w-full rounded-lg border border-app-border-strong bg-white px-3.5 py-2.5 text-sm text-app-text-primary outline-none focus:border-gold"
          />
        </label>

        {state?.error && <p className="text-xs text-app-error">{state.error}</p>}

        <SubmitButton />

        <p className="text-xs text-app-text-tertiary">
          {t("hint", { min: minLength })}
        </p>
      </form>
    </div>
  );
}
