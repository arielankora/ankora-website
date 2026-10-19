"use client";
import { useFormState, useFormStatus } from "react-dom";
import { setExceptionApproverAction } from "../actions";

// Org brain, phase 3 (spec decision 5): who may approve exceptions to a
// client's rules and sensitive information in a client file. A person,
// not a role. A client that named its own approvers overrides it there.

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="rounded-full border border-app-border px-4 py-2 text-xs font-medium text-app-text-primary disabled:opacity-50">
      {pending ? "נשמר..." : "שמירה"}
    </button>
  );
}

export function ExceptionApproverForm({ userId, value }: { userId: string; value: boolean }) {
  const [state, formAction] = useFormState(setExceptionApproverAction, {});
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="userId" value={userId} />
      <label className="flex items-center gap-2 text-sm text-app-text-primary">
        <input type="checkbox" name="canApproveExceptions" defaultChecked={value} className="h-4 w-4 accent-gold" />
        אישור חריגות ומידע רגיש
      </label>
      <SubmitButton />
      {state?.error && <p className="text-sm text-app-error">{state.error}</p>}
      {state?.ok && <p className="text-sm text-app-success">נשמר.</p>}
      <p className="w-full text-xs text-app-text-tertiary">
        מאשר/ת חריגות מכללים של לקוחות, ופריטים רגישים שהוצעו לתיק. לקוח שקבע מי מאשר אצלו גובר על ההרשאה הזו.
      </p>
    </form>
  );
}
