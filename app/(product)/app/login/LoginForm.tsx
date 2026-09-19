"use client";
import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import { loginAction } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-5 min-h-[50px] w-full rounded-full bg-gold-gradient text-[15px] font-medium text-ink disabled:opacity-50"
    >
      {pending ? "מתחבר…" : "כניסה"}
    </button>
  );
}

// App redesign (handoff README, screen 17): email + password both
// `dir="ltr"` with `text-align:right` (same RTL-for-LTR-content rule as
// signed numbers elsewhere in the redesign - see hour-banks/page.tsx's
// comment), a single inline error banner, and a "מתחבר…" pending state
// (already real - useFormStatus - just relabeled to match the design's
// exact wording). The field is still named/labelled for "אימייל או שם
// משתמש" rather than the prototype's "אימייל" alone: authenticateWithPassword
// (lib/app-auth/authenticate.ts) genuinely accepts either, and a label
// that only says "אימייל" would be actively wrong for a user who signs in
// with a username. The prototype's "ניסיונות שנותרו" (remaining-attempts
// count) in the error text is deliberately NOT reproduced: this app's
// login intentionally returns the exact same generic failure message
// whether the account doesn't exist, is suspended, is locked out, or the
// password was simply wrong (spec 20, authenticate.ts's own comment) -
// showing a real attempts-remaining count only when an account exists
// would reopen exactly the account-enumeration side channel that generic
// message exists to close. Building a safe, non-enumerating version of
// that counter (e.g. per-IP rather than per-account) is a real feature,
// but a new one - out of scope for a visual pass.
export function LoginForm() {
  const [state, formAction] = useFormState(loginAction, {});

  return (
    <form action={formAction}>
      <label className="block">
        <span className="mb-1.5 block text-xs text-navy/60">אימייל או שם משתמש</span>
        <input
          name="identifier"
          type="text"
          autoComplete="username"
          dir="ltr"
          required
          placeholder="name@ankora.co.il"
          className="w-full rounded-[10px] border border-lineDark bg-white px-3.5 py-3 text-end text-sm text-navy outline-none focus:border-gold"
        />
      </label>
      <label className="mt-3.5 block">
        <span className="mb-1.5 block text-xs text-navy/60">סיסמה</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          dir="ltr"
          required
          placeholder="••••••••"
          className="w-full rounded-[10px] border border-lineDark bg-white px-3.5 py-3 text-end text-sm text-navy outline-none focus:border-gold"
        />
      </label>

      {state?.error && (
        <p className="mt-3.5 flex items-center gap-2 rounded-[10px] border border-error/30 bg-error-soft px-3 py-2.5 text-xs text-error">
          {state.error}
        </p>
      )}

      <SubmitButton />

      <div className="mt-4 flex items-center justify-between gap-2.5">
        <Link href="/app/forgot-password" className="text-xs text-gold-dim hover:underline">
          שכחתי סיסמה
        </Link>
      </div>
    </form>
  );
}
