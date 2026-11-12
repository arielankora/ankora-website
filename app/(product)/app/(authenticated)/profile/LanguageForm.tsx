"use client";
import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { updateLocaleAction } from "./actions";
import { useActionForm } from "@/components/app/useActionForm";
import { APP_LOCALES, LOCALE_NATIVE_NAMES, directionOf, type AppLocale } from "@/lib/i18n/config";

// ADR 0006: the interface language. Each option is written in its own
// language and direction, so a person who cannot read the current one can
// still find theirs.
//
// On success the page is reloaded rather than refreshed: the language
// decides the direction of the whole document, the dictionary every client
// component already holds, and the dates the shell formatted. A full load
// is the one way all of them change together.
export function LanguageForm({ locale }: { locale: AppLocale }) {
  const t = useTranslations("profile");
  const { onSubmit, pending, error, ok } = useActionForm(updateLocaleAction);

  useEffect(() => {
    if (ok) window.location.reload();
  }, [ok]);

  return (
    <form onSubmit={onSubmit}>
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-app-text-secondary">{t("language.label")}</span>
        <select
          name="locale"
          defaultValue={locale}
          data-testid="profile-locale"
          className="w-full rounded-lg border border-app-border-strong bg-white px-3.5 py-2.5 text-sm text-app-text-primary outline-none focus:border-gold"
        >
          {APP_LOCALES.map((value) => (
            <option key={value} value={value} lang={value} dir={directionOf(value)}>
              {LOCALE_NATIVE_NAMES[value]}
            </option>
          ))}
        </select>
        <span className="mt-1.5 block text-[11.5px] text-app-text-tertiary">{t("language.hint")}</span>
      </label>

      {error && <p className="mt-2 text-xs text-app-error">{error}</p>}

      <button
        type="submit"
        disabled={pending || ok}
        className="mt-4 w-full rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50"
      >
        {pending || ok ? t("saving") : t("save")}
      </button>
    </form>
  );
}
