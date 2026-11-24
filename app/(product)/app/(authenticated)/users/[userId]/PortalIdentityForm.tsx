"use client";
import { useTranslations } from "next-intl";
import { useFormState, useFormStatus } from "react-dom";
import type { PortalGender } from "@prisma/client";
import { setPortalIdentityAction } from "../actions";

// 24.11.2026 (Hadas): the Hebrew name and the gender the client portal
// uses for this person as an account manager. Empty clears them.

function SubmitButton() {
  const { pending } = useFormStatus();
  const t = useTranslations("users.portalIdentity");
  return (
    <button type="submit" disabled={pending} className="tap-area rounded-full border border-app-border px-4 py-2 text-xs font-medium text-app-text-primary disabled:opacity-50">
      {pending ? t("saving") : t("save")}
    </button>
  );
}

export function PortalIdentityForm({ userId, name, gender }: { userId: string; name: string | null; gender: PortalGender | null }) {
  const t = useTranslations("users.portalIdentity");
  const [state, formAction] = useFormState(setPortalIdentityAction, {});
  const field = "w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold";
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="userId" value={userId} />
      <label className="block min-w-[200px] flex-1">
        <span className="mb-1.5 block text-xs text-app-text-secondary">{t("nameLabel")}</span>
        <input name="portalName" dir="auto" defaultValue={name ?? ""} className={field} />
      </label>
      <label className="block min-w-[140px]">
        <span className="mb-1.5 block text-xs text-app-text-secondary">{t("genderLabel")}</span>
        <select name="portalGender" defaultValue={gender ?? ""} className={field}>
          <option value="">{t("genderUnset")}</option>
          <option value="FEMALE">{t("FEMALE")}</option>
          <option value="MALE">{t("MALE")}</option>
        </select>
      </label>
      <SubmitButton />
      <p className="w-full text-xs text-app-text-tertiary">{t("hint")}</p>
      {state?.error && <p className="w-full text-sm text-app-error">{state.error}</p>}
      {state?.ok && <p className="w-full text-sm text-app-success">{t("saved")}</p>}
    </form>
  );
}
