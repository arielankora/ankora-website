"use client";
import { useState } from "react";
import { createCategoryAction } from "./actions";
import { useDrawerClose } from "@/components/app/Drawer";
import { useActionForm } from "@/components/app/useActionForm";

function SubmitButton({ pending }: { pending: boolean }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50"
    >
      {pending ? "נוצרת..." : "הוספת קטגוריה"}
    </button>
  );
}

// Redesign direction A: now rendered inside components/app/Drawer.tsx -
// see docs/adr/0001 addendum and CreateClientForm's comment for the same
// change applied consistently across every list screen.
export function CreateCategoryForm({ clients }: { clients: { id: string; name: string }[] }) {
  const [visibility, setVisibility] = useState<"GLOBAL" | "CLIENT">("GLOBAL");
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(createCategoryAction, close);

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div>
        <label className="block text-xs font-medium text-app-text-secondary">שם הקטגוריה *</label>
        <input
          name="name"
          required
          className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-app-text-secondary">תיאור</label>
        <input
          name="description"
          className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-app-text-secondary">היקף</label>
        <select
          name="visibility"
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as "GLOBAL" | "CLIENT")}
          className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        >
          <option value="GLOBAL">כללית (כל הלקוחות)</option>
          <option value="CLIENT">ספציפית ללקוח</option>
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-app-text-secondary">לקוח</label>
        <select
          name="clientId"
          disabled={visibility === "GLOBAL"}
          className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold disabled:opacity-40"
        >
          <option value="">בחירת לקוח</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="text-sm text-app-error">{error}</p>}
      <SubmitButton pending={pending} />
    </form>
  );
}
