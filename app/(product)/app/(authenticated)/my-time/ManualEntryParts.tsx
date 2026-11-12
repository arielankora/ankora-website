"use client";
import { useFormatter, useTranslations } from "next-intl";

// The pieces of a manual time entry that "הזמן שלי" and the task screen
// share (28.10.2026). The rules behind them live on the server
// (createManualEntry); these only have to say the same thing in both
// places.

export function todayKey(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
}

/// The conflicting entry's hours, in the reader's locale and time zone.
/// Also used by EntryRow, which shows the same warning.
export function useTimeRange(): (startIso: string, endIso: string | null) => string {
  const t = useTranslations("myTime.overlap");
  const format = useFormatter();
  return (startIso, endIso) => {
    const time = (iso: string) => format.dateTime(new Date(iso), { hour: "2-digit", minute: "2-digit" });
    const start = time(startIso);
    return endIso ? t("timeRange", { start, end: time(endIso) }) : t("timeRangeRunning", { start });
  };
}

/// Shown once the date is not today: the domain refuses a backdated entry
/// without a reason, so the field appears before the refusal could.
export function BackdateReasonField() {
  const t = useTranslations("myTime.form");
  return (
    <div className="mt-3 flex items-center gap-2.5 rounded-[10px] border border-gold/35 bg-gold/8 px-3 py-2.5">
      <span className="shrink-0 text-[12.5px] text-app-text-accent">{t("backdateLabel")}</span>
      <input
        name="backdateReason"
        required
        placeholder={t("backdatePlaceholder")}
        className="flex-1 rounded-lg border border-app-border-strong bg-white px-2.5 py-2 text-[13px] text-app-text-primary outline-none focus:border-gold"
      />
    </div>
  );
}

/// A cross-client overlap, which the person may confirm. See
/// my-time/entry-errors.ts for why it is a warning and not an error.
export function OverlapNotice({
  warning,
  onSaveAnyway,
  onDismiss,
}: {
  warning: { clientName: string; startAt: string; endAt: string | null };
  onSaveAnyway: () => void;
  onDismiss: () => void;
}) {
  const t = useTranslations("myTime.overlap");
  const formatTimeRange = useTimeRange();
  return (
    <div className="mt-3 rounded-[10px] border border-app-warning/35 bg-app-warning-soft px-3 py-2.5 text-[12.5px] text-app-warning">
      <p>{t("message", { client: warning.clientName, range: formatTimeRange(warning.startAt, warning.endAt) })}</p>
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={onSaveAnyway}
          className="rounded-full border border-app-warning/45 px-3.5 py-1.5 text-[12px] font-medium text-app-warning hover:bg-app-warning-soft"
        >
          {t("saveAnyway")}
        </button>
        <button type="button" onClick={onDismiss} className="text-[12px] text-app-text-secondary hover:text-app-text-primary">
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}
