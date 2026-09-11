"use client";
import { useFormState, useFormStatus } from "react-dom";
import { updateClientAction } from "../actions";
import type { Client } from "@prisma/client";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-ink disabled:opacity-50"
    >
      {pending ? "נשמר..." : "שמירת שינויים"}
    </button>
  );
}

export function EditClientForm({ client }: { client: Client }) {
  const [state, formAction] = useFormState(updateClientAction, {});

  return (
    <form action={formAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <input type="hidden" name="clientId" value={client.id} />
      <div>
        <label className="block text-xs font-medium text-navy/60">שם הלקוח</label>
        <input
          name="name"
          defaultValue={client.name}
          required
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-navy/60">שם משפטי</label>
        <input
          name="legalName"
          defaultValue={client.legalName ?? ""}
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-navy/60">איש קשר</label>
        <input
          name="primaryContact"
          defaultValue={client.primaryContact ?? ""}
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-navy/60">אזור זמן</label>
        <input
          name="timezone"
          defaultValue={client.timezone}
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-navy/60">סטטוס</label>
        <select
          name="status"
          defaultValue={client.status}
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        >
          <option value="ACTIVE">פעיל</option>
          <option value="PAUSED">מושהה</option>
          <option value="ARCHIVED">בארכיון</option>
        </select>
      </div>

      <div className="flex items-center gap-4 sm:col-span-2">
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        {state?.ok && <p className="text-sm text-emerald-700">נשמר בהצלחה.</p>}
        <div className="ms-auto">
          <SubmitButton />
        </div>
      </div>
    </form>
  );
}
