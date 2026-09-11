"use client";
import { useEffect, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { createCategoryAction } from "./actions";
import { useDrawerClose } from "@/components/app/Drawer";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-ink disabled:opacity-50"
    >
      {pending ? "נוצרת..." : "הוספת קטגוריה"}
    </button>
  );
}

// Redesign direction A: now rendered inside components/app/Drawer.tsx -
// see docs/adr/0001 addendum and CreateClientForm's comment for the same
// change applied consistently across every list screen.
export function CreateCategoryForm({ clients }: { clients: { id: string; name: string }[] }) {
  const [state, formAction] = useFormState(createCategoryAction, {});
  const [visibility, setVisibility] = useState<"GLOBAL" | "CLIENT">("GLOBAL");
  const close = useDrawerClose();

  useEffect(() => {
    if (state?.ok) close();
  }, [state, close]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div>
        <label className="block text-xs font-medium text-navy/60">שם הקטגוריה *</label>
        <input
          name="name"
          required
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-navy/60">תיאור</label>
        <input
          name="description"
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-navy/60">היקף</label>
        <select
          name="visibility"
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as "GLOBAL" | "CLIENT")}
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        >
          <option value="GLOBAL">כללית (כל הלקוחות)</option>
          <option value="CLIENT">ספציפית ללקוח</option>
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-navy/60">לקוח</label>
        <select
          name="clientId"
          disabled={visibility === "GLOBAL"}
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold disabled:opacity-40"
        >
          <option value="">בחירת לקוח</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <SubmitButton />
    </form>
  );
}
