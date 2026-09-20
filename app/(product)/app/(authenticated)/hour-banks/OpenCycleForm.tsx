"use client";
import { useEffect, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { openHourBankCycleAction } from "./actions";
import { useDrawerClose } from "@/components/app/Drawer";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-navy disabled:opacity-50"
    >
      {pending ? "פותח..." : "פתיחת מחזור חדש"}
    </button>
  );
}

export function OpenCycleForm({ clientId }: { clientId: string }) {
  const [state, formAction] = useFormState(openHourBankCycleAction, {});
  const [rolloverMode, setRolloverMode] = useState("NONE");
  const close = useDrawerClose();

  useEffect(() => {
    if (state?.ok) close();
  }, [state, close]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="clientId" value={clientId} />

      <div>
        <label className="block text-xs font-medium text-appNavy/60">תחילת מחזור *</label>
        <input
          type="date"
          name="cycleStart"
          required
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-appNavy outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-appNavy/60">סיום מחזור *</label>
        <input
          type="date"
          name="cycleEnd"
          required
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-appNavy outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-appNavy/60">דקות שנרכשו *</label>
        <input
          type="number"
          name="purchasedMinutes"
          min={0}
          required
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-appNavy outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-appNavy/60">Rollover למחזור הבא</label>
        <select
          name="rolloverMode"
          value={rolloverMode}
          onChange={(e) => setRolloverMode(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-appNavy outline-none focus:border-gold"
        >
          <option value="NONE">ללא</option>
          <option value="FULL">מלא</option>
          <option value="CAPPED">מוגבל (Cap)</option>
          <option value="MANUAL">ידני</option>
        </select>
        <p className="mt-1 text-[11px] text-appNavy/40">קובע כמה יעבור מהמחזור הזה למחזור הבא כשייפתח.</p>
      </div>

      {rolloverMode === "CAPPED" && (
        <div>
          <label className="block text-xs font-medium text-appNavy/60">תקרת Rollover (דקות)</label>
          <input
            type="number"
            name="rolloverCapMinutes"
            min={0}
            className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-appNavy outline-none focus:border-gold"
          />
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-appNavy/60">Rollover ידני מהמחזור הקודם</label>
        <input
          type="number"
          name="manualRolloverInMinutes"
          min={0}
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-appNavy outline-none focus:border-gold"
        />
        <p className="mt-1 text-[11px] text-appNavy/40">רלוונטי רק אם המחזור הקודם הוגדר כ&quot;ידני&quot; - הזינו כאן כמה דקות יעברו אליו.</p>
      </div>

      {state?.error && <p className="text-sm text-error">{state.error}</p>}
      <SubmitButton />
    </form>
  );
}
