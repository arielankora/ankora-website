"use client";
import { useFormState, useFormStatus } from "react-dom";
import { issueDeletionDeclarationAction } from "../actions";

// Employee agreements: sends the one-time link to the deletion
// declaration. For a suspended or archived user it is one press. For
// someone still active the button stays behind an explicit tick, because
// the message is about leaving and must not reach a working colleague by
// a misclick. The server checks the same thing.

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full border border-lineDark px-4 py-2 text-xs font-medium text-appNavy/70 hover:border-gold hover:text-appNavy disabled:opacity-50"
    >
      {pending ? "שולח..." : "שליחת הצהרת מחיקה"}
    </button>
  );
}

export function DeletionDeclarationForm({
  userId,
  isActive,
  hasPersonalEmail,
}: {
  userId: string;
  isActive: boolean;
  hasPersonalEmail: boolean;
}) {
  const [state, formAction] = useFormState(issueDeletionDeclarationAction, {});

  if (!hasPersonalEmail) {
    return <p className="mt-3 text-xs text-appNavy/60">כדי לשלוח, יש להוסיף מייל פרטי למעלה.</p>;
  }

  return (
    <form action={formAction} className="mt-3 space-y-3">
      <input type="hidden" name="userId" value={userId} />
      {isActive && (
        <label className="flex items-center gap-2 text-xs text-appNavy/70">
          <input type="checkbox" name="confirm" className="h-4 w-4 accent-gold" />
          המשתמש עדיין פעיל. השליחה מכוונת.
        </label>
      )}
      <SubmitButton />

      {state.error && <p className="text-xs text-error">{state.error}</p>}
      {state.link && (
        <div className="rounded-xl border border-lineDark bg-cream p-3">
          <p className="text-xs text-appNavy/70">
            {state.sent
              ? "נשלח מייל עם קישור לשבעה ימים. קישורים קודמים בוטלו."
              : "הקישור נוצר, אבל שליחת המייל נכשלה. אפשר להעביר אותו ידנית:"}
          </p>
          <p dir="ltr" className="mt-2 break-all text-[11px] text-appNavy/60">
            {state.link}
          </p>
        </div>
      )}
    </form>
  );
}
