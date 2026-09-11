"use client";
import { useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { setUserClientAccessAction } from "../actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-ink disabled:opacity-50"
    >
      {pending ? "נשמר..." : "עדכון גישה"}
    </button>
  );
}

export function ClientAccessForm({
  userId,
  clients,
  assignedClientIds,
}: {
  userId: string;
  clients: { id: string; name: string }[];
  assignedClientIds: string[];
}) {
  const [state, formAction] = useFormState(setUserClientAccessAction, {});
  const checkboxContainerRef = useRef<HTMLDivElement>(null);

  // "בחר הכל" / "נקה הכל" - convenience toggle over the existing
  // per-client checkbox list (Ariel, 2026-09-07: an Ankora employee like
  // Sharona had zero clients checked and there was no fast way to grant
  // her all of them). Deliberately does NOT change the underlying
  // per-employee UserClientAccess model or spec 4.1's restriction - it
  // just checks/unchecks every currently-listed checkbox client-side
  // before submit, same as manually clicking each one. A client added
  // later still requires an explicit re-save (see docs/adr/0001 for the
  // reasoning this was kept manual rather than an "all clients" flag).
  function setAllChecked(checked: boolean) {
    checkboxContainerRef.current
      ?.querySelectorAll<HTMLInputElement>('input[name="clientIds"]')
      .forEach((el) => {
        el.checked = checked;
      });
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="userId" value={userId} />
      {clients.length === 0 ? (
        <p className="text-sm text-navy/50">אין עדיין לקוחות במערכת.</p>
      ) : (
        <>
          <div className="flex items-center gap-3 text-xs">
            <button type="button" onClick={() => setAllChecked(true)} className="text-gold-dim underline">
              בחר הכל
            </button>
            <button type="button" onClick={() => setAllChecked(false)} className="text-navy/50 underline">
              נקה הכל
            </button>
          </div>
          <div ref={checkboxContainerRef} className="flex flex-wrap gap-3">
            {clients.map((c) => (
              <label key={c.id} className="flex items-center gap-1.5 text-sm text-navy/70">
                <input
                  type="checkbox"
                  name="clientIds"
                  value={c.id}
                  defaultChecked={assignedClientIds.includes(c.id)}
                  className="h-4 w-4 rounded border-lineDark"
                />
                {c.name}
              </label>
            ))}
          </div>
        </>
      )}

      <div className="flex items-center gap-4">
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        {state?.ok && <p className="text-sm text-emerald-700">עודכן בהצלחה.</p>}
        {clients.length > 0 && <SubmitButton />}
      </div>
    </form>
  );
}
