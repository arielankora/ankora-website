"use client";
import { createAlertRuleAction } from "./actions";
import { useActionForm } from "@/components/app/useActionForm";
import { useTranslations } from "next-intl";

function SubmitButton({ pending }: { pending: boolean }) {
  const t = useTranslations("alerts.form");
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50"
    >
      {pending ? t("creating") : t("submit")}
    </button>
  );
}

// Spec 9.1's four threshold types (Forecast is deliberately excluded -
// see ADR 11.5, that row is marked "Future" in the spec itself).
const THRESHOLD_TYPES = [
  { value: "UTILIZATION_PCT", key: "typeUtilizationPct" },
  { value: "REMAINING_MINUTES", key: "typeRemainingMinutes" },
  { value: "CONSUMED_MINUTES", key: "typeConsumedMinutes" },
  { value: "OVERAGE", key: "typeOverage" },
] as const;

export function AlertRuleForm({ clientId }: { clientId: string }) {
  const { onSubmit, pending, error, ok } = useActionForm(createAlertRuleAction);
  const t = useTranslations("alerts.form");

  return (
    <form
      onSubmit={onSubmit}
      className="grid grid-cols-1 gap-4 rounded-2xl border border-app-border bg-white p-6 sm:grid-cols-2 lg:grid-cols-4"
    >
      <input type="hidden" name="clientId" value={clientId} />

      <div>
        <label className="block text-xs font-medium text-app-text-secondary">{t("type")}</label>
        <select
          name="type"
          required
          className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        >
          {THRESHOLD_TYPES.map((type) => (
            <option key={type.value} value={type.value}>
              {t(type.key)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-app-text-secondary">{t("value")}</label>
        <input
          type="number"
          name="thresholdValue"
          required
          className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        />
      </div>

      <div className="flex items-end">
        <label className="flex items-center gap-2 text-xs font-medium text-app-text-secondary">
          <input type="checkbox" name="allowRetrigger" className="h-4 w-4 rounded border-app-border" />
          {t("allowRetrigger")}
        </label>
      </div>

      <div className="sm:col-span-2 lg:col-span-2">
        <label className="block text-xs font-medium text-app-text-secondary">{t("recipientsAnkora")}</label>
        <input
          name="recipientsAnkora"
          placeholder="ops@ankora.co.il, manager@ankora.co.il"
          className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        />
      </div>
      <div className="sm:col-span-2 lg:col-span-2">
        <label className="block text-xs font-medium text-app-text-secondary">{t("recipientsClient")}</label>
        <input
          name="recipientsClient"
          placeholder="finance@client.com"
          className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        />
      </div>

      <div className="flex items-end justify-between gap-4 sm:col-span-2 lg:col-span-4">
        {error && <p className="text-sm text-app-error">{error}</p>}
        {ok && <p className="text-sm text-app-success">{t("created")}</p>}
        <div className="ms-auto">
          <SubmitButton pending={pending} />
        </div>
      </div>
    </form>
  );
}
