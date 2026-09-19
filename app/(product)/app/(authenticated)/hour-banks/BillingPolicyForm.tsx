"use client";
import { useFormState, useFormStatus } from "react-dom";
import { upsertBillingPolicyAction } from "./actions";

function SubmitButton({ saved }: { saved: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="text-xs font-medium text-gold disabled:opacity-50"
    >
      {pending ? "שומר..." : saved ? "נשמר ✓" : "שמירה"}
    </button>
  );
}

// App redesign (handoff README, screen 10 "בנק שעות"): restyled from a
// full-width 4-column form into the narrower vertical field list the
// prototype's "מדיניות חיוב" card uses (label + inline input per row), now
// that hour-banks/page.tsx renders this inside a 1-of-3 card rather than a
// full-width section - and the submit button became a small inline
// "שמירה" -> "נשמר ✓" link matching the card's own compact header action,
// not a large gold pill (that treatment stays reserved for a screen's one
// primary action).
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
    <form action={formAction} className="flex flex-col gap-2.5">
      <input type="hidden" name="clientId" value={clientId} />

      <label className="flex items-center gap-2.5 text-[13px]">
        <span className="flex-1 text-navy/70">מינימום לדיווח</span>
        <input
          type="number"
          name="minimumMinutes"
          min={0}
          defaultValue={policy?.minimumMinutes ?? 0}
          dir="ltr"
          className="w-[70px] rounded-lg border border-lineDark bg-white px-2 py-1.5 text-center font-jbmono text-[13px] text-navy outline-none focus:border-gold"
        />
        <span className="text-xs text-navy/50">דק&apos;</span>
      </label>
      <label className="flex items-center gap-2.5 text-[13px]">
        <span className="flex-1 text-navy/70">יחידת עיגול</span>
        <input
          type="number"
          name="incrementMinutes"
          min={1}
          defaultValue={policy?.incrementMinutes ?? 1}
          dir="ltr"
          className="w-[70px] rounded-lg border border-lineDark bg-white px-2 py-1.5 text-center font-jbmono text-[13px] text-navy outline-none focus:border-gold"
        />
        <span className="text-xs text-navy/50">דק&apos;</span>
      </label>
      <label className="flex items-center gap-2.5 text-[13px]">
        <span className="flex-1 text-navy/70">שיטת עיגול</span>
        <select
          name="roundingMode"
          defaultValue={policy?.roundingMode ?? "EXACT"}
          className="rounded-lg border border-lineDark bg-white px-2 py-1.5 text-[13px] text-navy outline-none focus:border-gold"
        >
          <option value="EXACT">מדויק</option>
          <option value="CEIL">כלפי מעלה</option>
          <option value="NEAREST">לקרוב ביותר</option>
        </select>
      </label>
      <label className="flex items-center gap-2.5 text-[13px]">
        <span className="flex-1 text-navy/70">רמת צבירה</span>
        <select
          name="aggregationScope"
          defaultValue={policy?.aggregationScope ?? "PER_ENTRY"}
          className="rounded-lg border border-lineDark bg-white px-2 py-1.5 text-[13px] text-navy outline-none focus:border-gold"
        >
          <option value="PER_ENTRY">לפי דיווח</option>
          <option value="PER_TASK_PER_DAY">לפי משימה/יום</option>
          <option value="PER_DAY">לפי יום</option>
        </select>
      </label>

      <div className="mt-1 flex items-center justify-between gap-3">
        {state?.error ? <p className="text-xs text-error">{state.error}</p> : <span />}
        <SubmitButton saved={!!state?.ok} />
      </div>
    </form>
  );
}
