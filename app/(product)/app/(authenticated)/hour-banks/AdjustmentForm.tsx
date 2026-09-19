"use client";
import { useFormState, useFormStatus } from "react-dom";
import { recordAdjustmentAction } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full border border-lineDark px-3.5 py-2 text-xs text-navy transition-colors hover:border-gold disabled:opacity-50"
    >
      {pending ? "שומר..." : "הוספה"}
    </button>
  );
}

// App redesign (handoff README, screen 10 "בנק שעות"): restyled to fit the
// narrower 1-of-3 card layout (see hour-banks/page.tsx) matching the
// prototype's "דקות" + "סיבה" + "הוספה" row. **קריטי ל-RTL** (README):
// the minutes input carries dir="ltr" so a typed sign (+60/-15) doesn't
// visually flip.
export function AdjustmentForm({ clientId, currentHourBankId }: { clientId: string; currentHourBankId?: string }) {
  const [state, formAction] = useFormState(recordAdjustmentAction, {});

  return (
    <form action={formAction} className="flex flex-col gap-2.5">
      <input type="hidden" name="clientId" value={clientId} />
      {currentHourBankId && <input type="hidden" name="hourBankId" value={currentHourBankId} />}

      <div className="flex flex-wrap items-end gap-2.5">
        <label className="block w-[84px]">
          <span className="mb-1 block text-[11px] text-navy/55">דקות</span>
          <input
            type="number"
            name="minutes"
            required
            dir="ltr"
            className="w-full rounded-lg border border-lineDark bg-white px-2 py-1.5 text-center font-jbmono text-[13px] text-navy outline-none focus:border-gold"
          />
        </label>
        <label className="block min-w-0 flex-1">
          <span className="mb-1 block text-[11px] text-navy/55">סיבה</span>
          <input
            name="reason"
            required
            placeholder="למשל: זיכוי חד-פעמי"
            className="w-full rounded-lg border border-lineDark bg-white px-2.5 py-1.5 text-[13px] text-navy outline-none focus:border-gold"
          />
        </label>
        <SubmitButton />
      </div>

      {state?.error && <p className="text-xs text-error">{state.error}</p>}
      {state?.ok && <p className="text-xs text-success">ההתאמה נוספה.</p>}
      <p className="text-[11px] text-navy/45">כל התאמה נרשמת ביומן הפעולות עם שם המבצע.</p>
    </form>
  );
}
