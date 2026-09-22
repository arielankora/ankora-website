"use client";
import { useFormState, useFormStatus } from "react-dom";
import { resendInviteAction } from "../actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full border border-lineDark px-4 py-2 text-xs font-medium text-appNavy/70 hover:border-gold hover:text-appNavy disabled:opacity-50"
    >
      {pending ? "שולח..." : "שליחת הזמנה מחדש"}
    </button>
  );
}

// 22.9.2026. Only rendered for someone still INVITED, so the button
// cannot be pressed on an account where it means nothing.
//
// The link is shown alongside the result rather than only on failure,
// for the same reason InviteUserForm shows it: a mail that was sent is
// not a mail that arrived, and the admin should never have to come back
// and press this a second time to find out where the person is stuck.
export function ResendInviteForm({ userId }: { userId: string }) {
  const [state, formAction] = useFormState(resendInviteAction, {});

  return (
    <form action={formAction} className="mt-3">
      <input type="hidden" name="userId" value={userId} />
      <SubmitButton />

      {state.error && <p className="mt-3 text-xs text-error">{state.error}</p>}

      {state.inviteLink && (
        <div className="mt-3 rounded-xl border border-lineDark bg-cream p-3">
          <p className="text-xs text-appNavy/70">
            {state.sent
              ? "נשלח מייל עם קישור חדש. הקישור הקודם בוטל."
              : "הקישור החדש נוצר, אבל שליחת המייל נכשלה. אפשר להעביר אותו ידנית:"}
          </p>
          <p dir="ltr" className="mt-2 break-all text-[11px] text-appNavy/60">
            {state.inviteLink}
          </p>
        </div>
      )}
    </form>
  );
}
