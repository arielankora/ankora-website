"use client";
import { useFormState, useFormStatus } from "react-dom";
import { updateUserRoleStatusAction } from "../actions";
import type { User } from "@prisma/client";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50"
    >
      {pending ? "נשמר..." : "שמירת שינויים"}
    </button>
  );
}

// `Pick`, not `User`. Declaring the whole row invited the page to pass
// the whole row, and a client component's props are serialised into the
// page HTML - which is how the bcrypt hash of every user an admin opened
// ended up in page source. Narrowing the type here is what makes that
// mistake impossible to repeat quietly: the page cannot hand over a
// field this component has not asked for.
export function EditRoleStatusForm({
  targetUser,
  isSelf,
}: {
  targetUser: Pick<User, "id" | "role" | "status">;
  isSelf: boolean;
}) {
  const [state, formAction] = useFormState(updateUserRoleStatusAction, {});

  // What the selects show: the action's own answer once there is one,
  // the row the page was rendered with until then.
  //
  // React 19 resets the form when the action returns, and that reset
  // reaches the DOM of a select whatever React thinks its value is. So
  // the selects are uncontrolled, start from `shown`, and are keyed on
  // it: a save that changed something remounts them with the saved values
  // as their defaults, and the reset that follows can only reset them to
  // those. Found on the preview of PR #212 (pre-existing on main): after
  // saving, the screen said "נשמר" and the selects showed the old values.
  const shown = state?.saved ?? { role: targetUser.role, status: targetUser.status };
  const key = `${shown.role}|${shown.status}`;

  return (
    <form action={formAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <input type="hidden" name="userId" value={targetUser.id} />
      <div>
        <label className="block text-xs font-medium text-app-text-secondary">תפקיד</label>
        <select
          key={`role|${key}`}
          name="role"
          defaultValue={shown.role}
          disabled={isSelf}
          className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold disabled:opacity-40"
        >
          <option value="SUPER_ADMIN">מנהל-על</option>
          <option value="ANKORA_ADMIN">מנהל Ankora</option>
          <option value="ANKORA_EMPLOYEE">ספק פנימי אנקורה</option>
          <option value="CLIENT_USER">לקוח</option>
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-app-text-secondary">סטטוס</label>
        <select
          key={`status|${key}`}
          name="status"
          defaultValue={shown.status}
          disabled={isSelf}
          className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold disabled:opacity-40"
        >
          <option value="INVITED">הוזמן</option>
          <option value="ACTIVE">פעיל</option>
          <option value="SUSPENDED">מושהה</option>
          <option value="ARCHIVED">בארכיון</option>
        </select>
      </div>

      {isSelf && (
        <p className="text-xs text-app-text-tertiary sm:col-span-2">
          לא ניתן לשנות תפקיד או סטטוס עבור המשתמש המחובר, כדי למנוע נעילה עצמית בטעות.
        </p>
      )}

      <div className="flex items-center gap-4 sm:col-span-2">
        {state?.error && <p className="text-sm text-app-error">{state.error}</p>}
        {state?.ok && <p className="text-sm text-app-success">נשמר בהצלחה.</p>}
        {!isSelf && (
          <div className="ms-auto">
            <SubmitButton />
          </div>
        )}
      </div>
    </form>
  );
}
