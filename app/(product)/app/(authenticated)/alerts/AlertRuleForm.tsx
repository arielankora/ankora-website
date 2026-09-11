"use client";
import { useFormState, useFormStatus } from "react-dom";
import { createAlertRuleAction } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-ink disabled:opacity-50"
    >
      {pending ? "יוצר..." : "יצירת כלל התראה"}
    </button>
  );
}

// Spec 9.1's four threshold types (Forecast is deliberately excluded -
// see ADR 11.5, that row is marked "Future" in the spec itself).
const THRESHOLD_TYPES: { value: string; label: string }[] = [
  { value: "UTILIZATION_PCT", label: "אחוז ניצול (%)" },
  { value: "REMAINING_MINUTES", label: "דקות שנותרו (יורד מתחת ל...)" },
  { value: "CONSUMED_MINUTES", label: "דקות שנוצלו" },
  { value: "OVERAGE", label: "חריגה מהמכסה (דקות)" },
];

export function AlertRuleForm({ clientId }: { clientId: string }) {
  const [state, formAction] = useFormState(createAlertRuleAction, {});

  return (
    <form
      action={formAction}
      className="grid grid-cols-1 gap-4 rounded-2xl border border-lineDark bg-white p-6 sm:grid-cols-2 lg:grid-cols-4"
    >
      <input type="hidden" name="clientId" value={clientId} />

      <div>
        <label className="block text-xs font-medium text-navy/60">סוג סף *</label>
        <select
          name="type"
          required
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        >
          {THRESHOLD_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-navy/60">ערך סף *</label>
        <input
          type="number"
          name="thresholdValue"
          required
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        />
      </div>

      <div className="flex items-end">
        <label className="flex items-center gap-2 text-xs font-medium text-navy/60">
          <input type="checkbox" name="allowRetrigger" className="h-4 w-4 rounded border-lineDark" />
          לאפשר התראה חוזרת אחרי שנפתרה
        </label>
      </div>

      <div className="sm:col-span-2 lg:col-span-2">
        <label className="block text-xs font-medium text-navy/60">נמענים אצל Ankora (מופרד בפסיקים)</label>
        <input
          name="recipientsAnkora"
          placeholder="ops@ankora.co.il, manager@ankora.co.il"
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        />
      </div>
      <div className="sm:col-span-2 lg:col-span-2">
        <label className="block text-xs font-medium text-navy/60">נמענים אצל הלקוח (מופרד בפסיקים)</label>
        <input
          name="recipientsClient"
          placeholder="finance@client.com"
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        />
      </div>

      <div className="flex items-end justify-between gap-4 sm:col-span-2 lg:col-span-4">
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        {state?.ok && <p className="text-sm text-emerald-700">כלל ההתראה נוצר.</p>}
        <div className="ms-auto">
          <SubmitButton />
        </div>
      </div>
    </form>
  );
}
