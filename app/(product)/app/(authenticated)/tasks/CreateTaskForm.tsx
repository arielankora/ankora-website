"use client";
import { useEffect, useMemo, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { createTaskAction } from "./actions";
import { useDrawerClose } from "@/components/app/Drawer";

type Client = { id: string; name: string };
type Category = { id: string; name: string; clientId: string | null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-ink disabled:opacity-50"
    >
      {pending ? "נוצרת..." : "הוספת משימה"}
    </button>
  );
}

// Spec §11 Tasks screen + §6.1 ("Task נשמרת כישות אם המשתמש בוחר 'צור
// משימה'"). Client-then-category picker mirrors app/timer/TimerWidget.tsx
// exactly: categories are GLOBAL or scoped to the selected client.
//
// Redesign direction A: now rendered inside components/app/Drawer.tsx
// instead of an inline card above the (now-adjacent) filter bar + table -
// see docs/adr/0001 addendum. `useDrawerClose()` closes the drawer once
// the action reports `ok: true`, same pattern as CreateClientForm.
export function CreateTaskForm({ clients, categories }: { clients: Client[]; categories: Category[] }) {
  const [state, formAction] = useFormState(createTaskAction, {});
  const [clientId, setClientId] = useState("");
  const close = useDrawerClose();

  useEffect(() => {
    if (state?.ok) close();
  }, [state, close]);

  const availableCategories = useMemo(
    () => categories.filter((cat) => cat.clientId === null || cat.clientId === clientId),
    [categories, clientId]
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div>
        <label className="block text-xs font-medium text-navy/60">לקוח *</label>
        <select
          name="clientId"
          required
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        >
          <option value="">בחירת לקוח</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-navy/60">קטגוריה</label>
        <select
          name="categoryId"
          disabled={!clientId}
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold disabled:opacity-40"
        >
          <option value="">ללא קטגוריה</option>
          {availableCategories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-navy/60">שם המשימה *</label>
        <input
          name="title"
          required
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        />
      </div>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <SubmitButton />
    </form>
  );
}
