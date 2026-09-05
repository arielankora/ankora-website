"use client";
import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { inviteUserAction } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-ink disabled:opacity-50"
    >
      {pending ? "מוזמן..." : "הזמנת משתמש"}
    </button>
  );
}

export function InviteUserForm({ clients }: { clients: { id: string; name: string }[] }) {
  const [state, formAction] = useFormState(inviteUserAction, {});
  const [role, setRole] = useState("");
  const isClientUser = role === "CLIENT_USER";

  return (
    <div className="rounded-2xl border border-lineDark bg-white p-6">
      <form action={formAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="block text-xs font-medium text-navy/60">שם מלא *</label>
          <input
            name="name"
            required
            className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-navy/60">אימייל *</label>
          <input
            name="email"
            type="email"
            required
            className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-navy/60">תפקיד *</label>
          <select
            name="role"
            required
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
          >
            <option value="" disabled>
              בחירת תפקיד
            </option>
            <option value="SUPER_ADMIN">מנהל-על</option>
            <option value="ANKORA_ADMIN">מנהל Ankora</option>
            <option value="ANKORA_EMPLOYEE">עובד Ankora</option>
            <option value="CLIENT_USER">לקוח (פורטל לקוח)</option>
          </select>
        </div>

        {isClientUser ? (
          // Phase 6: a CLIENT_USER is scoped by a single ClientUser
          // membership (their Client Portal), not by the multi-client
          // UserClientAccess list below - see lib/app-domain/users.ts's
          // inviteUser doc comment. Exactly one client is required.
          <>
            <div>
              <label className="block text-xs font-medium text-navy/60">לקוח *</label>
              <select
                name="clientIds"
                required
                defaultValue=""
                className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
              >
                <option value="" disabled>
                  בחירת לקוח
                </option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-navy/60">תפקיד לקוח *</label>
              <select
                name="clientUserRole"
                required
                defaultValue="VIEWER"
                className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
              >
                <option value="VIEWER">צפייה בלבד</option>
                <option value="ADMIN">מנהל לקוח (יכול לערוך נמענים לדוחות)</option>
              </select>
            </div>
          </>
        ) : (
          <div className="sm:col-span-2 lg:col-span-4">
            <label className="block text-xs font-medium text-navy/60">גישה ללקוחות (אופציונלי)</label>
            <div className="mt-2 flex flex-wrap gap-3">
              {clients.length === 0 && <p className="text-xs text-navy/40">אין עדיין לקוחות במערכת.</p>}
              {clients.map((c) => (
                <label key={c.id} className="flex items-center gap-1.5 text-sm text-navy/70">
                  <input type="checkbox" name="clientIds" value={c.id} className="h-4 w-4 rounded border-lineDark" />
                  {c.name}
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-end justify-between gap-4 sm:col-span-2 lg:col-span-4">
          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
          <div className="ms-auto">
            <SubmitButton />
          </div>
        </div>
      </form>

      {state?.inviteLink && (
        <div className="mt-4 rounded-lg border border-lineDark bg-paperDim p-4 text-sm">
          <p className="text-navy">
            {state.invitedName} הוזמן בהצלחה. אין עדיין ספק אימייל מחובר (Phase 4) - יש להעביר את הקישור החד-פעמי
            הבא ידנית:
          </p>
          <p className="mt-2 break-all text-gold-dim">
            <a href={state.inviteLink}>{state.inviteLink}</a>
          </p>
        </div>
      )}
    </div>
  );
}
