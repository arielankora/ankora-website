"use client";
import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import { requestLoginLinkAction } from "../actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-5 min-h-[50px] w-full rounded-full bg-gold-gradient text-[15px] font-medium text-navy disabled:opacity-50"
    >
      {pending ? "שולח…" : "שליחת קישור כניסה"}
    </button>
  );
}

export function RequestLinkForm() {
  const [state, formAction] = useFormState(requestLoginLinkAction, {});

  if (state?.submitted) {
    return (
      <div className="space-y-3">
        <p className="text-[13px] text-appNavy/70">
          אם קיים חשבון פורטל עם הכתובת שהזנת, נשלח אליה קישור כניסה בתוקף ל-15 דקות.
        </p>
        {state.devLink && (
          <p className="rounded-[10px] border border-lineDark bg-cream-dim p-3 text-xs">
            סביבת פיתוח, קישור לבדיקה:{" "}
            <a href={state.devLink} className="text-gold-dim underline">
              {state.devLink}
            </a>
          </p>
        )}
        <Link href="/app/login" className="mt-1 block text-xs text-gold-dim">
          כניסה עם סיסמה
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction}>
      <label className="block">
        <span className="mb-1.5 block text-xs text-appNavy/60">אימייל</span>
        <input
          name="identifier"
          type="email"
          autoComplete="email"
          dir="ltr"
          required
          placeholder="name@example.com"
          className="w-full rounded-[10px] border border-lineDark bg-white px-3.5 py-3 text-end text-sm text-appNavy outline-none focus:border-gold"
        />
      </label>

      <SubmitButton />

      <p className="mt-4 text-xs text-appNavy/55">
        הקישור נשלח רק לכתובת שרשומה כמשתמש פורטל. מטעמי אבטחה לא נציין אם היא קיימת.
      </p>

      <Link href="/app/login" className="mt-4 block text-xs text-gold-dim">
        כניסה עם סיסמה
      </Link>
    </form>
  );
}
