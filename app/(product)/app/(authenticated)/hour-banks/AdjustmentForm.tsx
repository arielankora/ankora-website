"use client";
import { useFormState, useFormStatus } from "react-dom";
import { recordAdjustmentAction } from "./actions";
import { useTranslations } from "next-intl";

function SubmitButton() {
  const { pending } = useFormStatus();
  const t = useTranslations("hourBanks.adjustment");
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full border border-app-border px-3.5 py-2 text-xs text-app-text-primary transition-colors hover:border-gold disabled:opacity-50"
    >
      {pending ? t("saving") : t("add")}
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
  const t = useTranslations("hourBanks.adjustment");

  return (
    <form action={formAction} className="flex flex-col gap-2.5">
      <input type="hidden" name="clientId" value={clientId} />
      {currentHourBankId && <input type="hidden" name="hourBankId" value={currentHourBankId} />}

      <div className="flex flex-wrap items-end gap-2.5">
        <label className="block w-[84px]">
          <span className="mb-1 block text-[11px] text-app-text-secondary">{t("hours")}</span>
          <input
            name="hours"
            inputMode="decimal"
            placeholder="1.5"
            required
            dir="ltr"
            className="w-full rounded-lg border border-app-border-strong bg-white px-2 py-1.5 text-center font-jbmono text-[13px] text-app-text-primary outline-none focus:border-gold"
          />
        </label>
        <label className="block min-w-0 flex-1">
          <span className="mb-1 block text-[11px] text-app-text-secondary">{t("reason")}</span>
          <input
            name="reason"
            required
            placeholder={t("reasonPlaceholder")}
            className="w-full rounded-lg border border-app-border-strong bg-white px-2.5 py-1.5 text-[13px] text-app-text-primary outline-none focus:border-gold"
          />
        </label>
        <SubmitButton />
      </div>

      {state?.error && <p className="text-xs text-app-error">{state.error}</p>}
      {state?.ok && <p className="text-xs text-app-success">{t("added")}</p>}
      <p className="text-[11px] text-app-text-tertiary">{t("auditNote")}</p>
    </form>
  );
}
