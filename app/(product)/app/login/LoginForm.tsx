"use client";
import { useFormState, useFormStatus } from "react-dom";
import { loginAction } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-full bg-gold-gradient px-6 py-3 text-sm font-medium text-ink disabled:opacity-50"
    >
      {pending ? "מתחבר..." : "התחברות"}
    </button>
  );
}

export function LoginForm() {
  const [state, formAction] = useFormState(loginAction, {});

  return (
    <form action={formAction} className="mt-8 space-y-4">
      <div>
        <label className="block text-sm font-medium text-navy/70">אימייל או שם משתמש</label>
        <input
          name="identifier"
          type="text"
          autoComplete="username"
          required
          className="mt-2 w-full rounded-lg border border-lineDark bg-white px-4 py-2.5 text-navy outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-navy/70">סיסמה</label>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="mt-2 w-full rounded-lg border border-lineDark bg-white px-4 py-2.5 text-navy outline-none focus:border-gold"
        />
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <SubmitButton />
      <a href="/app/forgot-password" className="block text-center text-xs text-navy/50 hover:text-gold-dim">
        שכחתי סיסמה
      </a>
    </form>
  );
}
