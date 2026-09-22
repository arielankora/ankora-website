"use client";
import { useMemo, useState } from "react";
import { createTaskAction } from "./actions";
import { useDrawerClose } from "@/components/app/Drawer";
import { useActionForm } from "@/components/app/useActionForm";

type Client = { id: string; name: string };
type Category = { id: string; name: string; clientId: string | null };

function SubmitButton({ pending }: { pending: boolean }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-navy disabled:opacity-50"
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
  const [clientId, setClientId] = useState("");
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(createTaskAction, close);

  const availableCategories = useMemo(
    () => categories.filter((cat) => cat.clientId === null || cat.clientId === clientId),
    [categories, clientId]
  );

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div>
        <label className="block text-xs font-medium text-appNavy/60">לקוח *</label>
        <select
          name="clientId"
          required
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-appNavy outline-none focus:border-gold"
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
        <label className="block text-xs font-medium text-appNavy/60">קטגוריה</label>
        <select
          name="categoryId"
          disabled={!clientId}
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-appNavy outline-none focus:border-gold disabled:opacity-40"
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
        <label className="block text-xs font-medium text-appNavy/60">שם המשימה *</label>
        <input
          name="title"
          required
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-appNavy outline-none focus:border-gold"
        />
      </div>

      {/* Portal phase 1. Off by default: an internal task stays internal
          unless someone says otherwise, which is the safe direction for a
          field that decides what a client sees. The client-facing title
          is optional - left empty, the portal falls back to the task's
          own title rather than showing a blank row. */}
      <div className="rounded-lg border border-lineDark bg-cream-dim/40 p-3">
        <label className="flex items-center gap-2.5 text-xs text-appNavy">
          <input
            type="checkbox"
            name="clientVisible"
            className="h-4 w-4 rounded border-lineDark accent-gold"
          />
          הצגה ללקוח בפורטל
        </label>
        <label className="mt-2.5 block">
          <span className="block text-xs font-medium text-appNavy/60">כותרת ללקוח</span>
          <input
            name="clientTitle"
            placeholder="איך זה ייקרא אצל הלקוח. ברירת מחדל: שם המשימה"
            className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-appNavy outline-none focus:border-gold"
          />
        </label>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <SubmitButton pending={pending} />
    </form>
  );
}
