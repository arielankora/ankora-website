"use client";
import { useFormState, useFormStatus } from "react-dom";
import { upsertBillingPolicyAction } from "./actions";
import { useTranslations } from "next-intl";

function SubmitButton({ saved }: { saved: boolean }) {
  const { pending } = useFormStatus();
  const t = useTranslations("hourBanks.policy");
  return (
    <button
      type="submit"
      disabled={pending}
      className="text-xs font-medium text-app-text-accent disabled:opacity-50"
    >
      {pending ? t("saving") : saved ? t("saved") : t("save")}
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
  const t = useTranslations("hourBanks.policy");

  return (
    <form action={formAction} className="flex flex-col gap-2.5">
      <input type="hidden" name="clientId" value={clientId} />

      <label className="flex items-center gap-2.5 text-[13px]">
        <span className="flex-1 text-app-text-secondary">{t("minimum")}</span>
        <input
          type="number"
          name="minimumMinutes"
          min={0}
          defaultValue={policy?.minimumMinutes ?? 0}
          dir="ltr"
          className="w-[70px] rounded-lg border border-app-border-strong bg-white px-2 py-1.5 text-center font-jbmono text-[13px] text-app-text-primary outline-none focus:border-gold"
        />
        <span className="text-xs text-app-text-tertiary">{t("minutesShort")}</span>
      </label>
      <label className="flex items-center gap-2.5 text-[13px]">
        <span className="flex-1 text-app-text-secondary">{t("increment")}</span>
        <input
          type="number"
          name="incrementMinutes"
          min={1}
          defaultValue={policy?.incrementMinutes ?? 1}
          dir="ltr"
          className="w-[70px] rounded-lg border border-app-border-strong bg-white px-2 py-1.5 text-center font-jbmono text-[13px] text-app-text-primary outline-none focus:border-gold"
        />
        <span className="text-xs text-app-text-tertiary">{t("minutesShort")}</span>
      </label>
      <label className="flex items-center gap-2.5 text-[13px]">
        <span className="flex-1 text-app-text-secondary">{t("roundingMode")}</span>
        <select
          name="roundingMode"
          defaultValue={policy?.roundingMode ?? "EXACT"}
          className="rounded-lg border border-app-border-strong bg-white px-2 py-1.5 text-[13px] text-app-text-primary outline-none focus:border-gold"
        >
          <option value="EXACT">{t("exact")}</option>
          <option value="CEIL">{t("ceil")}</option>
          <option value="NEAREST">{t("nearest")}</option>
        </select>
      </label>
      <label className="flex items-center gap-2.5 text-[13px]">
        <span className="flex-1 text-app-text-secondary">{t("aggregation")}</span>
        <select
          name="aggregationScope"
          defaultValue={policy?.aggregationScope ?? "PER_ENTRY"}
          className="rounded-lg border border-app-border-strong bg-white px-2 py-1.5 text-[13px] text-app-text-primary outline-none focus:border-gold"
        >
          <option value="PER_ENTRY">{t("perEntry")}</option>
          <option value="PER_TASK_PER_DAY">{t("perTaskPerDay")}</option>
          <option value="PER_DAY">{t("perDay")}</option>
        </select>
      </label>

      <div className="mt-1 flex items-center justify-between gap-3">
        {state?.error ? <p className="text-xs text-app-error">{state.error}</p> : <span />}
        <SubmitButton saved={!!state?.ok} />
      </div>
    </form>
  );
}
