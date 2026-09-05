"use client";
import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { openHourBankCycleAction } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-ink disabled:opacity-50"
    >
      {pending ? "פותח..." : "פתיחת מחזור חדש"}
    </button>
  );
}

export function OpenCycleForm({ clientId }: { clientId: string }) {
  const [state, formAction] = useFormState(openHourBankCycleAction, {});
  const [rolloverMode, setRolloverMode] = useState("NONE");

  return (
    <form
      action={formAction}
      className="grid grid-cols-1 gap-4 rounded-2xl border border-lineDark bg-white p-6 sm:grid-cols-2 lg:grid-cols-4"
    >
      <input type="hidden" name="clientId" value={clientId} />

      <div>
        <label className="block text-xs font-medium text-navy/60">תחילת מחזור *</label>
        <input
          type="date"
          name="cycleStart"
          required
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-navy/60">סיום מחזור *</label>
        <input
          type="date"
          name="cycleEnd"
          required
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-navy/60">דקות שנרכשו *</label>
        <input
          type="number"
          name="purchasedMinutes"
          min={0}
          required
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-navy/60">Rollover למחזור הבא</label>
        <select
          name="rolloverMode"
          value={rolloverMode}
          onChange={(e) => setRolloverMode(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        >
          <option value="NONE">ללא</option>
          <option value="FULL">מלא</option>
          <option value="CAPPED">מוגבל (Cap)</option>
          <option value="MANUAL">ידני</option>
        </select>
        <p className="mt-1 text-[11px] text-navy/40">קובע כמה יעבור מהמחזור הזה למחזור הבא כשייפתח.</p>
      </div>

      {rolloverMode === "CAPPED" && (
        <div>
          <label className="block text-xs font-medium text-navy/60">תקרת Rollover (דקות)</label>
          <input
            type="number"
            name="rolloverCapMinutes"
            min={0}
            className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
          />
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-navy/60">Rollover ידני מהמחזור הקודם</label>
        <input
          type="number"
          name="manualRolloverInMinutes"
          min={0}
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        />
        <p className="mt-1 text-[11px] text-navy/40">רלוונטי רק אם המחזור הקודם הוגדר כ"ידני" - הזינו כאן כמה דקות יעברו אליו.</p>
      </div>

      <div className="flex items-end justify-between gap-4 sm:col-span-2 lg:col-span-4">
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        {state?.ok && <p className="text-sm text-emerald-700">המחזור נפתח.</p>}
        <div className="ms-auto">
          <SubmitButton />
        </div>
      </div>
    </form>
  );
}
