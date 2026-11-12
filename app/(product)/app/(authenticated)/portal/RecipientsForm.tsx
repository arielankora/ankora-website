"use client";
import { useFormState, useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { updatePortalRecipientsAction } from "./actions";

// ADR 0006: the report types this form can name (portal.recipients.reportTypes).
const REPORT_TYPES = ["MONTHLY_DETAILED", "WEEKLY_ACTIVITY", "HOURS_BY_CATEGORY", "HOUR_BANK_STATUS"] as const;
type ReportType = (typeof REPORT_TYPES)[number];
const isReportType = (value: string): value is ReportType => (REPORT_TYPES as readonly string[]).includes(value);

function SaveButton() {
  const t = useTranslations("portal.recipients");
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full bg-app-accent px-4 py-2 text-sm font-medium text-app-text-primary disabled:opacity-50"
    >
      {pending ? t("saving") : t("save")}
    </button>
  );
}

// Spec 13: "Client Admin יכול לנהל recipients לדוחות/alerts אם Ankora
// מאפשרת." Rendered by the portal history screen only for a Client Admin
// (getPortalHistory's canManageRecipients flag) - the actual permission
// check happens again server-side in updatePortalScheduleRecipients.
export function RecipientsForm({
  scheduleId,
  reportType,
  recipients,
}: {
  scheduleId: string;
  reportType: string;
  recipients: string[];
}) {
  const t = useTranslations("portal.recipients");
  const [state, formAction] = useFormState(updatePortalRecipientsAction, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-2 rounded-xl border border-app-border p-4 sm:flex-row sm:items-center sm:justify-between">
      <input type="hidden" name="scheduleId" value={scheduleId} />
      <div className="text-sm font-medium text-app-text-primary">{isReportType(reportType) ? t(`reportTypes.${reportType}`) : reportType}</div>
      <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        <input
          name="recipients"
          defaultValue={recipients.join(", ")}
          placeholder={t("placeholder")}
          className="w-full rounded-full border border-app-border-strong px-4 py-2 text-sm sm:max-w-sm"
        />
        <SaveButton />
      </div>
      {state?.error && <p className="text-sm text-app-error sm:basis-full">{state.error}</p>}
      {state?.ok && <p className="text-sm text-app-success sm:basis-full">{t("saved")}</p>}
    </form>
  );
}
