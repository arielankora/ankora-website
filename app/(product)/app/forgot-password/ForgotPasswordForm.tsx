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
      className="mt-5 min-h-[50px] w-full rounded-full bg-gold-gradient text-[15px] font-medium text-ink disabled:opacity-50"
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
        <p className="text-[13px] text-navy/70">
          אם קיים חשבון פעיל עם הפרטים שהזנת, נשלח אליו קישור לאיפוס סיסמה בתוקף לשעה.
        </p>
        {state.devLink && (
          <p className="rounded-[10px] border border-lineDark bg-paperDim p-3 text-xs">
            אין עדיין ספק אימייל מחובר (Phase 4) - קישור לבדיקה:{" "}
            <a href={state.devLink} className="text-gold-dim underline">
              {state.devLink}
            </a>
          </p>
        )}
        <Link href="/app/login" className="mt-1 block text-xs text-gold-dim">
          חזרה לכניסה
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction}>
      <label className="block">
        <span className="mb-1.5 block text-xs text-navy/60">אימייל</span>
        <input
          name="identifier"
          type="text"
          dir="ltr"
          required
          placeholder="name@ankora.co.il"
          className="w-full rounded-[10px] border border-lineDark bg-white px-3.5 py-3 text-end text-sm text-navy outline-none focus:border-gold"
        />
      </label>

      <SubmitButton />

      <p className="mt-4 text-xs text-navy/55">אם הכתובת קיימת במערכת יישלח מייל. מטעמי אבטחה לא נציין אם היא קיימת.</p>

      <Link href="/app/login" className="mt-4 block text-xs text-gold-dim">
        חזרה לכניסה
      </Link>
    </form>
  );
}
