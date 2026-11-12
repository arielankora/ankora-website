"use client";
import { useTranslations } from "next-intl";
import { useFormState, useFormStatus } from "react-dom";
import { setPersonalEmailAction } from "../actions";

// Employee agreements: where the deletion declaration goes once the work
// account is suspended. Empty clears it.

function SubmitButton() {
  const { pending } = useFormStatus();
  const t = useTranslations("users.personalEmail");
  return (
    <button type="submit" disabled={pending} className="rounded-full border border-app-border px-4 py-2 text-xs font-medium text-app-text-primary disabled:opacity-50">
      {pending ? t("saving") : t("save")}
    </button>
  );
}

export function PersonalEmailForm({ userId, value }: { userId: string; value: string | null }) {
  const t = useTranslations("users.personalEmail");
  const [state, formAction] = useFormState(setPersonalEmailAction, {});
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="userId" value={userId} />
      <label className="block min-w-[240px] flex-1">
        <span className="mb-1.5 block text-xs text-app-text-secondary">{t("label")}</span>
        <input
          name="personalEmail"
          type="email"
          dir="ltr"
          defaultValue={value ?? ""}
          className="w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        />
      </label>
      <SubmitButton />
      {state?.error && <p className="w-full text-sm text-app-error">{state.error}</p>}
      {state?.ok && <p className="w-full text-sm text-app-success">{t("saved")}</p>}
    </form>
  );
}
