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
      className="rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-ink disabled:opacity-50"
    >
      {pending ? "נשמר..." : "שמירת שינויים"}
    </button>
  );
}

export function EditRoleStatusForm({ targetUser, isSelf }: { targetUser: User; isSelf: boolean }) {
  const [state, formAction] = useFormState(updateUserRoleStatusAction, {});

  return (
    <form action={formAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <input type="hidden" name="userId" value={targetUser.id} />
      <div>
        <label className="block text-xs font-medium text-navy/60">תפקיד</label>
        <select
          name="role"
          defaultValue={targetUser.role}
          disabled={isSelf}
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold disabled:opacity-40"
        >
          <option value="SUPER_ADMIN">מנהל-על</option>
          <option value="ANKORA_ADMIN">מנהל Ankora</option>
          <option value="ANKORA_EMPLOYEE">עובד Ankora</option>
          <option value="CLIENT_USER">לקוח</option>
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-navy/60">סטטוס</label>
        <select
          name="status"
          defaultValue={targetUser.status}
          disabled={isSelf}
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold disabled:opacity-40"
        >
          <option value="INVITED">הוזמן</option>
          <option value="ACTIVE">פעיל</option>
          <option value="SUSPENDED">מושהה</option>
          <option value="ARCHIVED">בארכיון</option>
        </select>
      </div>

      {isSelf && (
        <p className="text-xs text-navy/40 sm:col-span-2">
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
