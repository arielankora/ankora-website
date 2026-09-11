"use client";
import { useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { inviteUserAction } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-ink disabled:opacity-50"
    >
      {pending ? "מוזמן..." : "הזמנת משתמש"}
    </button>
  );
}

// Redesign direction A: now rendered inside components/app/Drawer.tsx
// (see docs/adr/0001 addendum) instead of an inline card above the users
// table - the field grid is a single column now since the drawer is
// narrower than the old full-width card. Unlike CreateClientForm, this
// one deliberately does NOT auto-close the drawer on success: the
// one-time invite link below still needs to be visible so it can be
// copied (no email provider connected yet - Phase 4 TODO). The admin
// closes it manually via the drawer's own X once they've copied it.
export function InviteUserForm({ clients }: { clients: { id: string; name: string }[] }) {
  const [state, formAction] = useFormState(inviteUserAction, {});
  const [role, setRole] = useState("");
  const isClientUser = role === "CLIENT_USER";
  const checkboxContainerRef = useRef<HTMLDivElement>(null);

  // Same "בחר הכל"/"נקה הכל" convenience as ClientAccessForm - see that
  // file's comment. Here it saves a new Ankora employee from being
  // invited with zero client access by default (the checkbox list below
  // otherwise defaults every box to unchecked).
  function setAllChecked(checked: boolean) {
    checkboxContainerRef.current
      ?.querySelectorAll<HTMLInputElement>('input[name="clientIds"]')
      .forEach((el) => {
        el.checked = checked;
      });
  }

  return (
    <div>
      <form action={formAction} className="flex flex-col gap-4">
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
          <div>
            <div className="flex items-center justify-between">
              <label className="block text-xs font-medium text-navy/60">גישה ללקוחות (אופציונלי)</label>
              {clients.length > 0 && (
                <div className="flex items-center gap-3 text-xs">
                  <button type="button" onClick={() => setAllChecked(true)} className="text-gold-dim underline">
                    בחר הכל
                  </button>
                  <button type="button" onClick={() => setAllChecked(false)} className="text-navy/50 underline">
                    נקה הכל
                  </button>
                </div>
              )}
            </div>
            <div ref={checkboxContainerRef} className="mt-2 flex flex-col gap-2">
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

        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        <SubmitButton />
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
