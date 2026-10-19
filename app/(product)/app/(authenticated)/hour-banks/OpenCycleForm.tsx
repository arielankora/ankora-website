"use client";
import { useState } from "react";
import { openHourBankCycleAction } from "./actions";
import { useDrawerClose } from "@/components/app/Drawer";
import { useActionForm } from "@/components/app/useActionForm";

function SubmitButton({ pending }: { pending: boolean }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50"
    >
      {pending ? "פותח..." : "פתיחת מחזור חדש"}
    </button>
  );
}

export function OpenCycleForm({ clientId }: { clientId: string }) {
  const [rolloverMode, setRolloverMode] = useState("NONE");
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(openHourBankCycleAction, close);

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <input type="hidden" name="clientId" value={clientId} />

      <div>
        <label className="block text-xs font-medium text-app-text-secondary">תחילת מחזור *</label>
        <input
          type="date"
          name="cycleStart"
          required
          className="mt-1.5 w-full rounded-lg border border-app-border bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-app-text-secondary">סיום מחזור *</label>
        <input
          type="date"
          name="cycleEnd"
          required
          className="mt-1.5 w-full rounded-lg border border-app-border bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-app-text-secondary">שעות שנרכשו *</label>
        <input
          name="purchasedHours"
          inputMode="decimal"
          dir="ltr"
          placeholder="111 או 98.5"
          required
          className="mt-1.5 w-full rounded-lg border border-app-border bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-app-text-secondary">Rollover למחזור הבא</label>
        <select
          name="rolloverMode"
          value={rolloverMode}
          onChange={(e) => setRolloverMode(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-app-border bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        >
          <option value="NONE">ללא</option>
          <option value="FULL">מלא</option>
          <option value="CAPPED">מוגבל (Cap)</option>
          <option value="MANUAL">ידני</option>
        </select>
        <p className="mt-1 text-[11px] text-app-text-tertiary">קובע כמה יעבור מהמחזור הזה למחזור הבא כשייפתח.</p>
      </div>

      {rolloverMode === "CAPPED" && (
        <div>
          <label className="block text-xs font-medium text-app-text-secondary">תקרת Rollover (שעות)</label>
          <input
            name="rolloverCapHours"
            inputMode="decimal"
            dir="ltr"
            className="mt-1.5 w-full rounded-lg border border-app-border bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
          />
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-app-text-secondary">Rollover ידני מהמחזור הקודם</label>
        <input
          name="manualRolloverInHours"
          inputMode="decimal"
          dir="ltr"
          className="mt-1.5 w-full rounded-lg border border-app-border bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        />
        <p className="mt-1 text-[11px] text-app-text-tertiary">רלוונטי רק אם המחזור הקודם הוגדר כ&quot;ידני&quot; - הזינו כאן כמה שעות יעברו אליו.</p>
      </div>

      {error && <p className="text-sm text-app-error">{error}</p>}
      <SubmitButton pending={pending} />
    </form>
  );
}
