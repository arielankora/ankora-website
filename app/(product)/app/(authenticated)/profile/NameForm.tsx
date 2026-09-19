"use client";
import { useFormState, useFormStatus } from "react-dom";
import { updateNameAction } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-4 w-full rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-ink disabled:opacity-50"
    >
      {pending ? "נשמר..." : "שמירה"}
    </button>
  );
}

// App redesign (handoff README, screen 18): the prototype's editable "שם
// לתצוגה" field - see lib/app-domain/profile.ts's updateOwnName for the
// real capability this now calls (didn't exist before this pass; every
// prior phase's Profile screen only touched timezone/password).
export function NameForm({ name }: { name: string }) {
  const [state, formAction] = useFormState(updateNameAction, {});

  return (
    <form action={formAction}>
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-navy/60">שם לתצוגה</span>
        <input
          name="name"
          defaultValue={name}
          required
          maxLength={100}
          className="w-full rounded-lg border border-lineDark bg-white px-3.5 py-2.5 text-sm text-navy outline-none focus:border-gold"
        />
      </label>

      {state?.error && <p className="mt-2 text-xs text-error">{state.error}</p>}
      {state?.ok && <p className="mt-2 text-xs text-success">השם עודכן.</p>}

      <SubmitButton />
    </form>
  );
}
