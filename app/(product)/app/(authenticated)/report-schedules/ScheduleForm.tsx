"use client";
import { useState } from "react";
import { createReportScheduleAction } from "./actions";
import { useActionForm } from "@/components/app/useActionForm";
import { useTranslations } from "next-intl";
import { REPORT_TYPE_KEY, WEEKDAY_KEYS } from "./labels";

function SubmitButton({ pending }: { pending: boolean }) {
  const t = useTranslations("reportSchedules.form");
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

// Spec 14.1's client-report table minus "Trend" (marked "אופציונלי MVP+"
// in the spec itself - see schema.prisma's Phase 6 addendum comment).
const REPORT_TYPES = Object.entries(REPORT_TYPE_KEY).map(([value, key]) => ({ value, key }));

export function ScheduleForm({ clientId }: { clientId: string }) {
  const { onSubmit, pending, error, ok } = useActionForm(createReportScheduleAction);
  const t = useTranslations("reportSchedules");
  const [frequency, setFrequency] = useState<"WEEKLY" | "MONTHLY">("MONTHLY");

  return (
    <form
      onSubmit={onSubmit}
      className="grid grid-cols-1 gap-4 rounded-2xl border border-app-border bg-white p-6 sm:grid-cols-2 lg:grid-cols-4"
    >
      <input type="hidden" name="clientId" value={clientId} />

      <div>
        <label className="block text-xs font-medium text-app-text-secondary">{t("form.reportType")}</label>
        <select
          name="reportType"
          required
          className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        >
          {REPORT_TYPES.map((type) => (
            <option key={type.value} value={type.value}>
              {t(`types.${type.key}`)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-app-text-secondary">{t("form.frequency")}</label>
        <select
          name="frequency"
          required
          value={frequency}
          onChange={(e) => setFrequency(e.target.value as "WEEKLY" | "MONTHLY")}
          className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        >
          <option value="WEEKLY">{t("form.weekly")}</option>
          <option value="MONTHLY">{t("form.monthly")}</option>
        </select>
      </div>

      {frequency === "WEEKLY" ? (
        <div>
          <label className="block text-xs font-medium text-app-text-secondary">{t("form.dayOfWeek")}</label>
          <select
            name="dayOfWeek"
            className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
          >
            {WEEKDAY_KEYS.map((day, i) => (
              <option key={i} value={i}>
                {t(`weekdays.${day}`)}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div>
          <label className="block text-xs font-medium text-app-text-secondary">{t("form.dayOfMonth")}</label>
          <input
            type="number"
            name="dayOfMonth"
            min={1}
            max={28}
            defaultValue={1}
            className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
          />
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-app-text-secondary">{t("form.hour")}</label>
        <input
          type="number"
          name="hour"
          min={0}
          max={23}
          defaultValue={7}
          className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        />
        <p className="mt-1 text-[11px] text-app-text-tertiary">{t("form.hourHelp")}</p>
      </div>

      <div className="sm:col-span-2 lg:col-span-4">
        <label className="block text-xs font-medium text-app-text-secondary">{t("form.recipients")}</label>
        <input
          name="recipients"
          required
          placeholder="finance@client.com, ops@ankora.co.il"
          className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        />
      </div>

      <div className="flex items-end justify-between gap-4 sm:col-span-2 lg:col-span-4">
        {error && <p className="text-sm text-app-error">{error}</p>}
        {ok && <p className="text-sm text-app-success">{t("form.created")}</p>}
        <div className="ms-auto">
          <SubmitButton pending={pending} />
        </div>
      </div>
    </form>
  );
}
