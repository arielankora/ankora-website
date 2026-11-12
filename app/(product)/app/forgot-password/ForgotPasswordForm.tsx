"use client";
import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { forgotPasswordAction } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  const t = useTranslations("auth.forgot");
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-5 min-h-[50px] w-full rounded-full bg-app-accent text-[15px] font-medium text-app-text-primary disabled:opacity-50"
    >
      {pending ? t("sending") : t("send")}
    </button>
  );
}

export function ForgotPasswordForm() {
  const [state, formAction] = useFormState(forgotPasswordAction, {});
  const t = useTranslations("auth.forgot");

  if (state?.submitted) {
    return (
      <div className="space-y-3">
        <p className="text-[13px] text-app-text-secondary">
          {t("submitted")}
        </p>
        {state.devLink && (
          <p className="rounded-[10px] border border-app-border bg-cream-dim p-3 text-xs">
            {t("devLink")}{" "}
            <a href={state.devLink} className="text-app-text-accent underline">
              {state.devLink}
            </a>
          </p>
        )}
        <Link href="/app/login" className="mt-1 block py-2 text-xs text-app-text-accent">
          {t("backToSignIn")}
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction}>
      <label className="block">
        <span className="mb-1.5 block text-xs text-app-text-secondary">{t("email")}</span>
        <input
          name="identifier"
          type="text"
          dir="ltr"
          required
          placeholder="name@ankora.co.il"
          className="w-full rounded-[10px] border border-app-border-strong bg-white px-3.5 py-3 text-page-start text-sm text-app-text-primary outline-none focus:border-gold"
        />
      </label>

      <SubmitButton />

      <p className="mt-4 text-xs text-app-text-secondary">{t("privacyNote")}</p>

      <Link href="/app/login" className="mt-2 block py-2 text-xs text-app-text-accent">
        {t("backToSignIn")}
      </Link>
    </form>
  );
}
