"use client";
import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import { forgotPasswordAction } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-5 min-h-[50px] w-full rounded-full bg-app-accent text-[15px] font-medium text-app-text-primary disabled:opacity-50"
    >
      {pending ? "שולח…" : "שליחת קישור"}
    </button>
  );
}

export function ForgotPasswordForm() {
  const [state, formAction] = useFormState(forgotPasswordAction, {});

  if (state?.submitted) {
    return (
      <div className="space-y-3">
        <p className="text-[13px] text-app-text-secondary">
          אם קיים חשבון פעיל עם הפרטים שהזנת, נשלח אליו קישור לאיפוס סיסמה בתוקף לשעה.
        </p>
        {state.devLink && (
          <p className="rounded-[10px] border border-app-border bg-cream-dim p-3 text-xs">
            אין עדיין ספק אימייל מחובר (Phase 4) - קישור לבדיקה:{" "}
            <a href={state.devLink} className="text-app-text-accent underline">
              {state.devLink}
            </a>
          </p>
        )}
        <Link href="/app/login" className="mt-1 block py-2 text-xs text-app-text-accent">
          חזרה לכניסה
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction}>
      <label className="block">
        <span className="mb-1.5 block text-xs text-app-text-secondary">אימייל</span>
        <input
          name="identifier"
          type="text"
          dir="ltr"
          required
          placeholder="name@ankora.co.il"
          className="w-full rounded-[10px] border border-app-border-strong bg-white px-3.5 py-3 text-end text-sm text-app-text-primary outline-none focus:border-gold"
        />
      </label>

      <SubmitButton />

      <p className="mt-4 text-xs text-app-text-secondary">אם הכתובת קיימת במערכת יישלח מייל. מטעמי אבטחה לא נציין אם היא קיימת.</p>

      <Link href="/app/login" className="mt-2 block py-2 text-xs text-app-text-accent">
        חזרה לכניסה
      </Link>
    </form>
  );
}
