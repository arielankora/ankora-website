"use client";
import { useRef, useState } from "react";
import { inviteUserAction } from "./actions";
import { useActionForm } from "@/components/app/useActionForm";

function SubmitButton({ pending }: { pending: boolean }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50"
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
//
// Moved off `useFormState` + `<form action>`. It was held back when the
// other eleven forms moved, on the grounds that it shows what the action
// returns and the replacement carried only ok-or-error. That was wrong:
// the replacement carries the whole answer, which is what `result` below
// reads.
//
// The pattern it leaves is the one measured at twenty seconds to
// acknowledge a write that took a millisecond, because the form waits
// inside the screen's re-render rather than on the action. Eleven more
// forms are still on it - five under /app/users and /app/hour-banks, the
// two inline row editors, and the login and password screens, which have
// a real reason (they redirect, and a directly-called action cannot).
// The rest do not, and they are worth a change of their own rather than
// a detour inside this one.
export function InviteUserForm({ clients }: { clients: { id: string; name: string }[] }) {
  const { onSubmit, pending, result } = useActionForm(inviteUserAction);
  const state = result;
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
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div>
          <label className="block text-xs font-medium text-app-text-secondary">שם מלא *</label>
          <input
            name="name"
            required
            className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-app-text-secondary">אימייל *</label>
          <input
            name="email"
            type="email"
            required
            className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
          />
        </div>
        {/* Employee agreements: the address the deletion declaration is
            sent to when the person leaves and their work account is
            suspended. Staff only; a client's own address is their login. */}
        {role !== "CLIENT_USER" && (
          <div>
            <label className="block text-xs font-medium text-app-text-secondary">מייל פרטי</label>
            <input
              name="personalEmail"
              type="email"
              dir="ltr"
              className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
            />
            <p className="mt-1 text-[11px] text-app-text-tertiary">לא חובה. משמש רק לשליחת מסמכים בסיום העבודה.</p>
          </div>
        )}
        <div>
          <label className="block text-xs font-medium text-app-text-secondary">תפקיד *</label>
          <select
            name="role"
            required
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
          >
            <option value="" disabled>
              בחירת תפקיד
            </option>
            <option value="SUPER_ADMIN">מנהל-על</option>
            <option value="ANKORA_ADMIN">מנהל Ankora</option>
            <option value="ANKORA_EMPLOYEE">ספק פנימי אנקורה</option>
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
              <label className="block text-xs font-medium text-app-text-secondary">לקוח *</label>
              <select
                name="clientIds"
                required
                defaultValue=""
                className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
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
              <label className="block text-xs font-medium text-app-text-secondary">תפקיד לקוח *</label>
              <select
                name="clientUserRole"
                required
                defaultValue="VIEWER"
                className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
              >
                <option value="VIEWER">צפייה בלבד</option>
                <option value="ADMIN">מנהל לקוח (יכול לערוך נמענים לדוחות)</option>
              </select>
            </div>
          </>
        ) : (
          <div>
            <div className="flex items-center justify-between">
              <label className="block text-xs font-medium text-app-text-secondary">גישה ללקוחות (אופציונלי)</label>
              {clients.length > 0 && (
                <div className="flex items-center gap-3 text-xs">
                  <button type="button" onClick={() => setAllChecked(true)} className="text-app-text-accent underline">
                    בחר הכל
                  </button>
                  <button type="button" onClick={() => setAllChecked(false)} className="text-app-text-tertiary underline">
                    נקה הכל
                  </button>
                </div>
              )}
            </div>
            <div ref={checkboxContainerRef} className="mt-2 flex flex-col gap-2">
              {clients.length === 0 && <p className="text-xs text-app-text-tertiary">אין עדיין לקוחות במערכת.</p>}
              {clients.map((c) => (
                <label key={c.id} className="flex items-center gap-1.5 text-sm text-app-text-secondary">
                  <input type="checkbox" name="clientIds" value={c.id} className="h-4 w-4 rounded border-app-border" />
                  {c.name}
                </label>
              ))}
            </div>
          </div>
        )}

        {state?.error && <p className="text-sm text-app-error">{state.error}</p>}
        <SubmitButton pending={pending} />
      </form>

      {state?.inviteLink && (
        <div className="mt-4 rounded-lg border border-app-border bg-cream-dim p-4 text-sm">
          <p className="text-app-text-primary">
            {state.emailSent
              ? `${state.invitedName} הוזמן בהצלחה, והמייל נשלח. הקישור החד-פעמי הבא הוא גיבוי אם המייל לא הגיע:`
              : `${state.invitedName} הוזמן בהצלחה, אך שליחת המייל נכשלה. יש להעביר את הקישור החד-פעמי הבא ידנית:`}
          </p>
          <p className="mt-2 break-all text-app-text-accent">
            <a href={state.inviteLink}>{state.inviteLink}</a>
          </p>
        </div>
      )}
    </div>
  );
}
