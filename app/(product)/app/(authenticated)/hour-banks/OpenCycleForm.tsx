"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { openHourBankCycleAction } from "./actions";
import { useDrawerClose } from "@/components/app/Drawer";
import { useActionForm } from "@/components/app/useActionForm";

function SubmitButton({ pending }: { pending: boolean }) {
  const t = useTranslations("hourBanks.cycleForm");
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50"
    >
      {pending ? t("opening") : t("submit")}
    </button>
  );
}

export function OpenCycleForm({ clientId }: { clientId: string }) {
  const [rolloverMode, setRolloverMode] = useState("NONE");
  const t = useTranslations("hourBanks.cycleForm");
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(openHourBankCycleAction, close);

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <input type="hidden" name="clientId" value={clientId} />

      <div>
        <label className="block text-xs font-medium text-app-text-secondary">{t("cycleStart")}</label>
        <input
          type="date"
          name="cycleStart"
          required
          className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-app-text-secondary">{t("cycleEnd")}</label>
        <input
          type="date"
          name="cycleEnd"
          required
          className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-app-text-secondary">{t("purchasedHours")}</label>
        <input
          name="purchasedHours"
          inputMode="decimal"
          dir="ltr"
          placeholder={t("hoursPlaceholder")}
          required
          className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-app-text-secondary">{t("rollover")}</label>
        <select
          name="rolloverMode"
          value={rolloverMode}
          onChange={(e) => setRolloverMode(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        >
          <option value="NONE">{t("rolloverNone")}</option>
          <option value="FULL">{t("rolloverFull")}</option>
          <option value="CAPPED">{t("rolloverCapped")}</option>
          <option value="MANUAL">{t("rolloverManual")}</option>
        </select>
        <p className="mt-1 text-[11px] text-app-text-tertiary">{t("rolloverHelp")}</p>
      </div>

      {rolloverMode === "CAPPED" && (
        <div>
          <label className="block text-xs font-medium text-app-text-secondary">{t("capHours")}</label>
          <input
            name="rolloverCapHours"
            inputMode="decimal"
            dir="ltr"
            className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
          />
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-app-text-secondary">{t("manualRolloverIn")}</label>
        <input
          name="manualRolloverInHours"
          inputMode="decimal"
          dir="ltr"
          className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        />
        <p className="mt-1 text-[11px] text-app-text-tertiary">{t("manualRolloverHelp")}</p>
      </div>

      {error && <p className="text-sm text-app-error">{error}</p>}
      <SubmitButton pending={pending} />
    </form>
  );
}
