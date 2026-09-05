"use client";
import { useFormState, useFormStatus } from "react-dom";
import { recordAdjustmentAction } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-ink disabled:opacity-50"
    >
      {pending ? "שומר..." : "הוספת התאמה"}
    </button>
  );
}

// Spec 8.2 "manual adjustments" - positive minutes = credit, negative =
// deduction. Defaults to the client's current cycle server-side when no
// specific hourBankId is supplied here.
export function AdjustmentForm({ clientId, currentHourBankId }: { clientId: string; currentHourBankId?: string }) {
  const [state, formAction] = useFormState(recordAdjustmentAction, {});

  return (
    <form
      action={formAction}
      className="grid grid-cols-1 gap-4 rounded-2xl border border-lineDark bg-white p-6 sm:grid-cols-2 lg:grid-cols-4"
    >
      <input type="hidden" name="clientId" value={clientId} />
      {currentHourBankId && <input type="hidden" name="hourBankId" value={currentHourBankId} />}

      <div>
        <label className="block text-xs font-medium text-navy/60">דקות (חיובי = זיכוי, שלילי = חיוב) *</label>
        <input
          type="number"
          name="minutes"
          required
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        />
      </div>
      <div className="sm:col-span-2">
        <label className="block text-xs font-medium text-navy/60">סיבה *</label>
        <input
          name="reason"
          required
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        />
      </div>

      <div className="flex items-end justify-between gap-4 sm:col-span-2 lg:col-span-4">
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        {state?.ok && <p className="text-sm text-emerald-700">ההתאמה נוספה.</p>}
        <div className="ms-auto">
          <SubmitButton />
        </div>
      </div>
    </form>
  );
}
