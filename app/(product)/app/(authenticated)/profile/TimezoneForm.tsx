"use client";
import { updateTimezoneAction } from "./actions";
import { useActionForm } from "@/components/app/useActionForm";

function SubmitButton({ pending }: { pending: boolean }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-4 w-full rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-navy disabled:opacity-50"
    >
      {pending ? "נשמר..." : "שמירה"}
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
const CURATED_TIMEZONES = [
  { value: "Asia/Jerusalem", label: "ירושלים (Asia/Jerusalem)" },
  { value: "Europe/London", label: "לונדון (Europe/London)" },
  { value: "America/New_York", label: "ניו יורק (America/New_York)" },
];

export function TimezoneForm({ timezone }: { timezone: string }) {
  const { onSubmit, pending, error, ok } = useActionForm(updateTimezoneAction);
  const options = CURATED_TIMEZONES.some((tz) => tz.value === timezone)
    ? CURATED_TIMEZONES
    : [{ value: timezone, label: timezone }, ...CURATED_TIMEZONES];

  return (
    <form onSubmit={onSubmit}>
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-appNavy/60">אזור זמן</span>
        <select
          name="timezone"
          defaultValue={timezone}
          className="w-full rounded-lg border border-lineDark bg-white px-3.5 py-2.5 text-sm text-appNavy outline-none focus:border-gold"
        >
          {options.map((tz) => (
            <option key={tz.value} value={tz.value}>
              {tz.label}
            </option>
          ))}
        </select>
      </label>

      {error && <p className="mt-2 text-xs text-error">{error}</p>}
      {ok && <p className="mt-2 text-xs text-success">אזור הזמן עודכן.</p>}

      <SubmitButton pending={pending} />
    </form>
  );
}
