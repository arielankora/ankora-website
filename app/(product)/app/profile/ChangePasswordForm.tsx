"use client";
import { useFormState, useFormStatus } from "react-dom";
import { changePasswordAction } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-ink disabled:opacity-50"
    >
      {pending ? "מתבצע..." : "החלפת סיסמה"}
    </button>
  );
}

export function ChangePasswordForm() {
  const [state, formAction] = useFormState(changePasswordAction, {});

  return (
    <form action={formAction} className="grid grid-cols-1 gap-4 rounded-2xl border border-lineDark bg-white p-6 sm:grid-cols-3">
      <div>
        <label className="block text-xs font-medium text-navy/60">סיסמה נוכחית *</label>
        <input
          type="password"
          name="currentPassword"
          required
          autoComplete="current-password"
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-navy/60">סיסמה חדשה *</label>
        <input
          type="password"
          name="newPassword"
          required
          autoComplete="new-password"
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-navy/60">אימות סיסמה חדשה *</label>
        <input
          type="password"
          name="confirmPassword"
          required
          autoComplete="new-password"
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        />
      </div>

      <div className="flex items-end justify-between gap-4 sm:col-span-3">
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        <div className="ms-auto">
          <SubmitButton />
        </div>
      </div>
      <p className="text-xs text-navy/50 sm:col-span-3">
        לפחות 10 תווים. החלפת סיסמה מנתקת את כל ההתחברויות הפעילות, כולל זו הנוכחית - תתבקשו להתחבר מחדש.
      </p>
    </form>
  );
}
