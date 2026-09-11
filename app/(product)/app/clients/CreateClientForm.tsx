"use client";
import { useEffect } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { createClientAction } from "./actions";
import { useDrawerClose } from "@/components/app/Drawer";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-ink disabled:opacity-50"
    >
      {pending ? "נוצר..." : "הוספת לקוח"}
    </button>
  );
}

// Redesign direction A: now rendered inside components/app/Drawer.tsx
// instead of sitting inline above the clients table (see docs/adr/0001
// addendum). `useDrawerClose()` closes the drawer once the server
// action reports `ok: true` - this form previously just stayed open
// and relied on the fresh row appearing in the (now-adjacent) table.
export function CreateClientForm() {
  const [state, formAction] = useFormState(createClientAction, {});
  const close = useDrawerClose();

  useEffect(() => {
    if (state?.ok) close();
  }, [state, close]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div>
        <label className="block text-xs font-medium text-navy/60">שם הלקוח *</label>
        <input
          name="name"
          required
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-navy/60">שם משפטי</label>
        <input
          name="legalName"
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-navy/60">איש קשר</label>
        <input
          name="primaryContact"
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-navy/60">אזור זמן</label>
        <input
          name="timezone"
          defaultValue="Asia/Jerusalem"
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        />
      </div>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <SubmitButton />
    </form>
  );
}
