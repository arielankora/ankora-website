"use client";
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

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="userId" value={userId} />
      {clients.length === 0 ? (
        <p className="text-sm text-navy/50">אין עדיין לקוחות במערכת.</p>
      ) : (
        <div className="flex flex-wrap gap-3">
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
      )}

      <div className="flex items-center gap-4">
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        {state?.ok && <p className="text-sm text-emerald-700">עודכן בהצלחה.</p>}
        {clients.length > 0 && <SubmitButton />}
      </div>
    </form>
  );
}
