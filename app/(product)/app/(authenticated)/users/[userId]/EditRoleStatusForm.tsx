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
      className="rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-navy disabled:opacity-50"
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

  return (
    <form action={formAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <input type="hidden" name="userId" value={targetUser.id} />
      <div>
        <label className="block text-xs font-medium text-appNavy/60">תפקיד</label>
        <select
          name="role"
          defaultValue={targetUser.role}
          disabled={isSelf}
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-appNavy outline-none focus:border-gold disabled:opacity-40"
        >
          <option value="SUPER_ADMIN">מנהל-על</option>
          <option value="ANKORA_ADMIN">מנהל Ankora</option>
          <option value="ANKORA_EMPLOYEE">עובד Ankora</option>
          <option value="CLIENT_USER">לקוח</option>
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-appNavy/60">סטטוס</label>
        <select
          name="status"
          defaultValue={targetUser.status}
          disabled={isSelf}
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-appNavy outline-none focus:border-gold disabled:opacity-40"
        >
          <option value="INVITED">הוזמן</option>
          <option value="ACTIVE">פעיל</option>
          <option value="SUSPENDED">מושהה</option>
          <option value="ARCHIVED">בארכיון</option>
        </select>
      </div>

      {isSelf && (
        <p className="text-xs text-appNavy/40 sm:col-span-2">
          לא ניתן לשנות תפקיד או סטטוס עבור המשתמש המחובר, כדי למנוע נעילה עצמית בטעות.
        </p>
      )}

      <div className="flex items-center gap-4 sm:col-span-2">
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        {state?.ok && <p className="text-sm text-emerald-700">נשמר בהצלחה.</p>}
        {!isSelf && (
          <div className="ms-auto">
            <SubmitButton />
          </div>
        )}
      </div>
    </form>
  );
}
