"use client";
import { useFormState, useFormStatus } from "react-dom";
import { upsertBillingPolicyAction } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-ink disabled:opacity-50"
    >
      {pending ? "שומר..." : "שמירת מדיניות חיוב"}
    </button>
  );
}

export function BillingPolicyForm({
  clientId,
  policy,
}: {
  clientId: string;
  policy: {
    minimumMinutes: number;
    incrementMinutes: number;
    roundingMode: string;
    aggregationScope: string;
  } | null;
}) {
  const [state, formAction] = useFormState(upsertBillingPolicyAction, {});

  return (
    <form
      action={formAction}
      className="grid grid-cols-1 gap-4 rounded-2xl border border-lineDark bg-white p-6 sm:grid-cols-2 lg:grid-cols-4"
    >
      <input type="hidden" name="clientId" value={clientId} />

      <div>
        <label className="block text-xs font-medium text-navy/60">מינימום לדיווח (דקות)</label>
        <input
          type="number"
          name="minimumMinutes"
          min={0}
          defaultValue={policy?.minimumMinutes ?? 0}
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-navy/60">יחידת עיגול (דקות)</label>
        <input
          type="number"
          name="incrementMinutes"
          min={1}
          defaultValue={policy?.incrementMinutes ?? 1}
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-navy/60">שיטת עיגול</label>
        <select
          name="roundingMode"
          defaultValue={policy?.roundingMode ?? "EXACT"}
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        >
          <option value="EXACT">מדויק (ללא עיגול)</option>
          <option value="CEIL">עיגול כלפי מעלה</option>
          <option value="NEAREST">עיגול לקרוב ביותר</option>
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-navy/60">רמת צבירה</label>
        <select
          name="aggregationScope"
          defaultValue={policy?.aggregationScope ?? "PER_ENTRY"}
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        >
          <option value="PER_ENTRY">לפי דיווח בודד</option>
          <option value="PER_TASK_PER_DAY">לפי משימה ליום</option>
          <option value="PER_DAY">לפי יום</option>
        </select>
      </div>

      <div className="flex items-end justify-between gap-4 sm:col-span-2 lg:col-span-4">
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        {state?.ok && <p className="text-sm text-emerald-700">נשמר.</p>}
        <div className="ms-auto">
          <SubmitButton />
        </div>
      </div>
    </form>
  );
}
