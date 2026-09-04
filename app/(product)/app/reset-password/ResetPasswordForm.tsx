"use client";
import { useFormState, useFormStatus } from "react-dom";
import { resetPasswordAction } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-full bg-gold-gradient px-6 py-3 text-sm font-medium text-ink disabled:opacity-50"
    >
      {pending ? "שומר..." : "קביעת סיסמה"}
    </button>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction] = useFormState(resetPasswordAction, {});

  if (state?.done) {
    return (
      <div className="mt-8 space-y-4 text-sm text-navy/70">
        <p>הסיסמה נקבעה בהצלחה.</p>
        <a href="/app/login" className="block text-center text-gold-dim underline">
          מעבר להתחברות
        </a>
      </div>
    );
  }

  return (
    <form action={formAction} className="mt-8 space-y-4">
      <input type="hidden" name="token" value={token} />
      <div>
        <label className="block text-sm font-medium text-navy/70">סיסמה חדשה (10 תווים לפחות)</label>
        <input
          name="password"
          type="password"
          minLength={10}
          required
          className="mt-2 w-full rounded-lg border border-lineDark bg-white px-4 py-2.5 text-navy outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-navy/70">אימות סיסמה</label>
        <input
          name="confirm"
          type="password"
          minLength={10}
          required
          className="mt-2 w-full rounded-lg border border-lineDark bg-white px-4 py-2.5 text-navy outline-none focus:border-gold"
        />
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <SubmitButton />
    </form>
  );
}
