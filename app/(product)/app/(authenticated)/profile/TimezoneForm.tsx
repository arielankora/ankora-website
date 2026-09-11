"use client";
import { useFormState, useFormStatus } from "react-dom";
import { updateTimezoneAction } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-ink disabled:opacity-50"
    >
      {pending ? "נשמר..." : "שמירה"}
    </button>
  );
}

export function TimezoneForm({ timezone }: { timezone: string }) {
  const [state, formAction] = useFormState(updateTimezoneAction, {});

  return (
    <form action={formAction} className="grid grid-cols-1 gap-4 rounded-2xl border border-lineDark bg-white p-6 sm:grid-cols-3">
      <div>
        <label className="block text-xs font-medium text-navy/60">אזור זמן</label>
        <input
          name="timezone"
          defaultValue={timezone}
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        />
        <p className="mt-1 text-xs text-navy/40">לדוגמה: Asia/Jerusalem</p>
      </div>

      <div className="flex items-end justify-between gap-4 sm:col-span-3">
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        {state?.ok && <p className="text-sm text-emerald-700">אזור הזמן עודכן.</p>}
        <div className="ms-auto">
          <SubmitButton />
        </div>
      </div>
    </form>
  );
}
