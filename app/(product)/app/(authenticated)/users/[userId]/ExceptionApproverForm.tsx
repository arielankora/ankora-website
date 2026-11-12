"use client";
import { useTranslations } from "next-intl";
import { useFormState, useFormStatus } from "react-dom";
import { setExceptionApproverAction } from "../actions";

// Org brain, phase 3 (spec decision 5): who may approve exceptions to a
// client's rules and sensitive information in a client file. A person,
// not a role. A client that named its own approvers overrides it there.

function SubmitButton() {
  const { pending } = useFormStatus();
  const t = useTranslations("users.exceptionApprover");
  return (
    <button type="submit" disabled={pending} className="rounded-full border border-app-border px-4 py-2 text-xs font-medium text-app-text-primary disabled:opacity-50">
      {pending ? t("saving") : t("save")}
    </button>
  );
}

export function ExceptionApproverForm({ userId, value }: { userId: string; value: boolean }) {
  const t = useTranslations("users.exceptionApprover");
  const [state, formAction] = useFormState(setExceptionApproverAction, {});
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="userId" value={userId} />
      <label className="flex items-center gap-2 text-sm text-app-text-primary">
        <input type="checkbox" name="canApproveExceptions" defaultChecked={value} className="h-4 w-4 accent-gold" />
        {t("label")}
      </label>
      <SubmitButton />
      {state?.error && <p className="text-sm text-app-error">{state.error}</p>}
      {state?.ok && <p className="text-sm text-app-success">{t("saved")}</p>}
      <p className="w-full text-xs text-app-text-tertiary">
        {t("hint")}
      </p>
    </form>
  );
}
