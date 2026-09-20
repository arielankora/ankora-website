"use client";
import Link from "next/link";
import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { resetPasswordAction } from "./actions";

// Kept in sync with lib/app-auth/password.ts's PASSWORD_MIN_LENGTH (10) -
// not imported directly so this client component doesn't pull the
// server-only bcryptjs hashing module into the browser bundle just for
// one number.
const MIN_LENGTH = 10;
const STRONG_LENGTH = 12;

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-5 min-h-[50px] w-full rounded-full bg-gold-gradient text-[15px] font-medium text-navy disabled:opacity-50"
    >
      {pending ? "שומר…" : "שמירה וכניסה"}
    </button>
  );
}

// App redesign (handoff README, screen 17 "בחירת סיסמה חדשה"): three-bar
// strength meter (red/gold/green) + a word label. The prototype's copy
// claims a requirement for "אות גדולה ומספר" (uppercase + a digit) that
// this app's real password policy (validatePasswordPolicy,
// lib/app-auth/password.ts) doesn't actually enforce - only a 10-char
// minimum plus a common-weak-password blocklist - so the subtitle here
// states the real rule instead of an invented stricter one, and the
// meter's thresholds are anchored to that same real minimum (weak <10,
// medium 10-11, strong >=12) rather than the prototype's arbitrary 8/12.
// The confirm-password field the prototype omits is kept: it's a real
// safety net against a mistyped new password locking someone out, not a
// design flourish, and dropping it would be a regression.
export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction] = useFormState(resetPasswordAction, {});
  const [password, setPassword] = useState("");

  const score = password.length >= STRONG_LENGTH ? 3 : password.length >= MIN_LENGTH ? 2 : password.length > 0 ? 1 : 0;
  const barColor = score === 1 ? "bg-error" : score === 2 ? "bg-gold" : score === 3 ? "bg-success" : "bg-lineDark";
  const label =
    score === 0 ? "בחרו סיסמה" : score === 1 ? "חלשה — קצרה מדי" : score === 2 ? "בינונית" : "חזקה";

  if (state?.done) {
    return (
      <div className="space-y-4">
        <p className="text-[13px] text-appNavy/70">הסיסמה נקבעה בהצלחה.</p>
        <Link href="/app/login" className="block text-center text-sm text-gold-dim underline">
          מעבר להתחברות
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="token" value={token} />
      <label className="block">
        <span className="mb-1.5 block text-xs text-appNavy/60">סיסמה חדשה</span>
        <input
          name="password"
          type="password"
          dir="ltr"
          required
          minLength={MIN_LENGTH}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-[10px] border border-lineDark bg-white px-3.5 py-3 text-end text-sm text-appNavy outline-none focus:border-gold"
        />
      </label>

      <div className="mt-2 flex gap-1.5">
        {[1, 2, 3].map((i) => (
          <span key={i} className={`h-1 flex-1 rounded-full ${score >= i ? barColor : "bg-lineDark"}`} />
        ))}
      </div>
      <p className="mt-1.5 text-xs text-appNavy/55">{label}</p>

      <label className="mt-3.5 block">
        <span className="mb-1.5 block text-xs text-appNavy/60">אימות סיסמה</span>
        <input
          name="confirm"
          type="password"
          dir="ltr"
          required
          minLength={MIN_LENGTH}
          className="w-full rounded-[10px] border border-lineDark bg-white px-3.5 py-3 text-end text-sm text-appNavy outline-none focus:border-gold"
        />
      </label>

      {state?.error && (
        <p className="mt-3.5 rounded-[10px] border border-error/30 bg-error-soft px-3 py-2.5 text-xs text-error">
          {state.error}
        </p>
      )}

      <SubmitButton />
    </form>
  );
}
