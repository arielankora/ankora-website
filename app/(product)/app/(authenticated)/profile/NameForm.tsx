"use client";
import { updateNameAction } from "./actions";
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

// App redesign (handoff README, screen 18): the prototype's editable "שם
// לתצוגה" field - see lib/app-domain/profile.ts's updateOwnName for the
// real capability this now calls (didn't exist before this pass; every
// prior phase's Profile screen only touched timezone/password).
export function NameForm({ name }: { name: string }) {
  const { onSubmit, pending, error, ok } = useActionForm(updateNameAction);

  return (
    <form onSubmit={onSubmit}>
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-appNavy/60">שם לתצוגה</span>
        <input
          name="name"
          defaultValue={name}
          required
          maxLength={100}
          className="w-full rounded-lg border border-lineDark bg-white px-3.5 py-2.5 text-sm text-appNavy outline-none focus:border-gold"
        />
      </label>

      {error && <p className="mt-2 text-xs text-error">{error}</p>}
      {ok && <p className="mt-2 text-xs text-success">השם עודכן.</p>}

      <SubmitButton pending={pending} />
    </form>
  );
}
