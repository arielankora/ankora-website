"use client";
import { createClientAction } from "./actions";
import { useDrawerClose } from "@/components/app/Drawer";
import { useActionForm } from "@/components/app/useActionForm";

function SubmitButton({ pending }: { pending: boolean }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50"
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
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(createClientAction, close);

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div>
        <label className="block text-xs font-medium text-app-text-secondary">שם הלקוח *</label>
        <input
          name="name"
          required
          className="mt-1.5 w-full rounded-lg border border-app-border bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-app-text-secondary">שם משפטי</label>
        <input
          name="legalName"
          className="mt-1.5 w-full rounded-lg border border-app-border bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-app-text-secondary">איש קשר</label>
        <input
          name="primaryContact"
          className="mt-1.5 w-full rounded-lg border border-app-border bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-app-text-secondary">אזור זמן</label>
        <input
          name="timezone"
          defaultValue="Asia/Jerusalem"
          className="mt-1.5 w-full rounded-lg border border-app-border bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        />
      </div>

      {error && <p className="text-sm text-app-error">{error}</p>}
      <SubmitButton pending={pending} />
    </form>
  );
}
