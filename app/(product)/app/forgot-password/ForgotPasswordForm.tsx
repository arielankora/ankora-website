"use client";
import { useFormState, useFormStatus } from "react-dom";
import { forgotPasswordAction } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-full bg-gold-gradient px-6 py-3 text-sm font-medium text-ink disabled:opacity-50"
    >
      {pending ? "שולח..." : "שליחת קישור לאיפוס"}
    </button>
  );
}

export function ForgotPasswordForm() {
  const [state, formAction] = useFormState(forgotPasswordAction, {});

  if (state?.submitted) {
    return (
      <div className="mt-8 space-y-3 text-sm text-navy/70">
        <p>אם קיים חשבון פעיל עם הפרטים שהזנת, נשלח אליו קישור לאיפוס סיסמה בתוקף לשעה.</p>
        {state.devLink && (
          <p className="rounded-lg border border-lineDark bg-paperDim p-3 text-xs">
            אין עדיין ספק אימייל מחובר (Phase 4) - קישור לבדיקה:{" "}
            <a href={state.devLink} className="text-gold-dim underline">
              {state.devLink}
            </a>
          </p>
        )}
      </div>
    );
  }

  return (
    <form action={formAction} className="mt-8 space-y-4">
      <div>
        <label className="block text-sm font-medium text-navy/70">אימייל או שם משתמש</label>
        <input
          name="identifier"
          type="text"
          required
          className="mt-2 w-full rounded-lg border border-lineDark bg-white px-4 py-2.5 text-navy outline-none focus:border-gold"
        />
      </div>
      <SubmitButton />
    </form>
  );
}
