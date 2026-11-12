"use client";
import { useTranslations } from "next-intl";
import { updateTimezoneAction } from "./actions";
import { useActionForm } from "@/components/app/useActionForm";

function SubmitButton({ pending }: { pending: boolean }) {
  const t = useTranslations("profile");
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-4 w-full rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50"
    >
      {pending ? t("saving") : t("save")}
    </button>
  );
}

// App redesign (handoff README, screen 18): the prototype shows "אזור זמן"
// as a <select> with a few example cities rather than the old free-text
// input. The real field (User.timezone, updateOwnTimezone) is still a
// plain, unvalidated string - there's no server-side IANA allow-list to
// match against - so this stays a curated convenience list rather than a
// fabricated constraint: the user's *current* value is always included as
// an option even when it isn't one of the curated ones (e.g. it was set to
// something else before this screen existed, or via a future admin tool),
// so saving without touching this field can never silently overwrite it
// with an unrelated city.
//
// ADR 0006: the city is the dictionary's; the zone id after it is not
// translated, it is what is stored.
const CURATED_TIMEZONES = [
  { value: "Asia/Jerusalem", city: "jerusalem" },
  { value: "Europe/London", city: "london" },
  { value: "America/New_York", city: "newYork" },
] as const;

export function TimezoneForm({ timezone }: { timezone: string }) {
  const t = useTranslations("profile");
  const { onSubmit, pending, error, ok } = useActionForm(updateTimezoneAction);
  const curated = CURATED_TIMEZONES.map((tz) => ({
    value: tz.value,
    label: `${t(`timezone.cities.${tz.city}`)} (${tz.value})`,
  }));
  const options = curated.some((tz) => tz.value === timezone) ? curated : [{ value: timezone, label: timezone }, ...curated];

  return (
    <form onSubmit={onSubmit}>
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-app-text-secondary">{t("timezone.label")}</span>
        <select
          name="timezone"
          defaultValue={timezone}
          className="w-full rounded-lg border border-app-border-strong bg-white px-3.5 py-2.5 text-sm text-app-text-primary outline-none focus:border-gold"
        >
          {options.map((tz) => (
            <option key={tz.value} value={tz.value}>
              {tz.label}
            </option>
          ))}
        </select>
      </label>

      {error && <p className="mt-2 text-xs text-app-error">{error}</p>}
      {ok && <p className="mt-2 text-xs text-app-success">{t("timezone.saved")}</p>}

      <SubmitButton pending={pending} />
    </form>
  );
}
