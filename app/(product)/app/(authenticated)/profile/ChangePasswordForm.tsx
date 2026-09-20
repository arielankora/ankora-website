"use client";
import { useFormState, useFormStatus } from "react-dom";
import { changePasswordAction } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-1 w-full rounded-full border border-gold/40 px-5 py-2.5 text-sm font-medium text-gold-dim disabled:opacity-50"
    >
      {pending ? "מתבצע..." : "החלפת סיסמה"}
    </button>
  );
}

// App redesign (handoff README, screen 18): the prototype's "סיסמה" card
// shows an "עודכנה לפני 3 חודשים" example line - that exact string is a
// mockup placeholder, not a real value, so `lastChangedLabel` (computed in
// page.tsx from lib/app-domain/profile.ts's getLastPasswordChangeAt, which
// reads the real audit trail) is passed in and rendered instead of any
// hardcoded text; null renders no line at all rather than guessing.
export function ChangePasswordForm({ lastChangedLabel }: { lastChangedLabel: string | null }) {
  const [state, formAction] = useFormState(changePasswordAction, {});

  return (
    <div>
      {lastChangedLabel && <p className="mb-4 text-xs text-appNavy/50">{lastChangedLabel}</p>}

      <form action={formAction} className="space-y-3">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-appNavy/60">סיסמה נוכחית</span>
          <input
            type="password"
            name="currentPassword"
            required
            autoComplete="current-password"
            className="w-full rounded-lg border border-lineDark bg-white px-3.5 py-2.5 text-sm text-appNavy outline-none focus:border-gold"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-appNavy/60">סיסמה חדשה</span>
          <input
            type="password"
            name="newPassword"
            required
            autoComplete="new-password"
            className="w-full rounded-lg border border-lineDark bg-white px-3.5 py-2.5 text-sm text-appNavy outline-none focus:border-gold"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-appNavy/60">אימות סיסמה חדשה</span>
          <input
            type="password"
            name="confirmPassword"
            required
            autoComplete="new-password"
            className="w-full rounded-lg border border-lineDark bg-white px-3.5 py-2.5 text-sm text-appNavy outline-none focus:border-gold"
          />
        </label>

        {state?.error && <p className="text-xs text-error">{state.error}</p>}

        <SubmitButton />

        <p className="text-xs text-appNavy/50">
          לפחות 10 תווים. החלפת סיסמה מנתקת את כל ההתחברויות הפעילות, כולל זו הנוכחית - תתבקשו להתחבר מחדש.
        </p>
      </form>
    </div>
  );
}
