"use client";
import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { createReportScheduleAction } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-ink disabled:opacity-50"
    >
      {pending ? "יוצר..." : "יצירת דוח מתוזמן"}
    </button>
  );
}

// Spec 14.1's client-report table minus "Trend" (marked "אופציונלי MVP+"
// in the spec itself - see schema.prisma's Phase 6 addendum comment).
const REPORT_TYPES: { value: string; label: string }[] = [
  { value: "MONTHLY_DETAILED", label: "דוח חודשי מפורט" },
  { value: "WEEKLY_ACTIVITY", label: "פעילות שבועית" },
  { value: "HOURS_BY_CATEGORY", label: "סיכום קטגוריות" },
  { value: "HOUR_BANK_STATUS", label: "סטטוס בנק שעות" },
];

const WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

export function ScheduleForm({ clientId }: { clientId: string }) {
  const [state, formAction] = useFormState(createReportScheduleAction, {});
  const [frequency, setFrequency] = useState<"WEEKLY" | "MONTHLY">("MONTHLY");

  return (
    <form
      action={formAction}
      className="grid grid-cols-1 gap-4 rounded-2xl border border-lineDark bg-white p-6 sm:grid-cols-2 lg:grid-cols-4"
    >
      <input type="hidden" name="clientId" value={clientId} />

      <div>
        <label className="block text-xs font-medium text-navy/60">סוג דוח *</label>
        <select
          name="reportType"
          required
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        >
          {REPORT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-navy/60">תדירות *</label>
        <select
          name="frequency"
          required
          value={frequency}
          onChange={(e) => setFrequency(e.target.value as "WEEKLY" | "MONTHLY")}
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        >
          <option value="WEEKLY">שבועי</option>
          <option value="MONTHLY">חודשי</option>
        </select>
      </div>

      {frequency === "WEEKLY" ? (
        <div>
          <label className="block text-xs font-medium text-navy/60">יום בשבוע</label>
          <select
            name="dayOfWeek"
            className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
          >
            {WEEKDAYS.map((label, i) => (
              <option key={i} value={i}>
                {label}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div>
          <label className="block text-xs font-medium text-navy/60">יום בחודש (1-28)</label>
          <input
            type="number"
            name="dayOfMonth"
            min={1}
            max={28}
            defaultValue={1}
            className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
          />
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-navy/60">שעה מועדפת (0-23)</label>
        <input
          type="number"
          name="hour"
          min={0}
          max={23}
          defaultValue={7}
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        />
        <p className="mt-1 text-[11px] text-navy/40">בפועל נשלח פעם ביום; זהו תיעוד ההעדפה בלבד.</p>
      </div>

      <div className="sm:col-span-2 lg:col-span-4">
        <label className="block text-xs font-medium text-navy/60">נמענים (מופרד בפסיקים) *</label>
        <input
          name="recipients"
          required
          placeholder="finance@client.com, ops@ankora.co.il"
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        />
      </div>

      <div className="flex items-end justify-between gap-4 sm:col-span-2 lg:col-span-4">
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        {state?.ok && <p className="text-sm text-emerald-700">הדוח המתוזמן נוצר.</p>}
        <div className="ms-auto">
          <SubmitButton />
        </div>
      </div>
    </form>
  );
}
