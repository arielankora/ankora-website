"use client";

// The pieces of a manual time entry that "הזמן שלי" and the task screen
// share (28.10.2026). The rules behind them live on the server
// (createManualEntry); these only have to say the same thing in both
// places.

export function todayKey(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
}

function formatTimeRange(startIso: string, endIso: string | null): string {
  const fmt = new Intl.DateTimeFormat("he-IL", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jerusalem" });
  const start = fmt.format(new Date(startIso));
  if (!endIso) return `${start} (טיימר פעיל)`;
  return `${start}-${fmt.format(new Date(endIso))}`;
}

/// Shown once the date is not today: the domain refuses a backdated entry
/// without a reason, so the field appears before the refusal could.
export function BackdateReasonField() {
  return (
    <div className="mt-3 flex items-center gap-2.5 rounded-[10px] border border-gold/35 bg-gold/8 px-3 py-2.5">
      <span className="shrink-0 text-[12.5px] text-app-text-accent">דיווח ליום קודם - נדרשת סיבה</span>
      <input
        name="backdateReason"
        required
        placeholder="למשל: נשכח לדווח בזמן"
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
  return (
    <div className="mt-3 rounded-[10px] border border-app-warning/35 bg-app-warning-soft px-3 py-2.5 text-[12.5px] text-app-warning">
      <p>
        קיים כבר דיווח בשעה זו עבור {warning.clientName} ({formatTimeRange(warning.startAt, warning.endAt)}). דיווח
        מקביל אפשרי רק כשמדובר בלקוחות שונים - אם אכן כך, אפשר לשמור בכל זאת.
      </p>
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={onSaveAnyway}
          className="rounded-full border border-app-warning/45 px-3.5 py-1.5 text-[12px] font-medium text-app-warning hover:bg-app-warning-soft"
        >
          שמירה בכל זאת
        </button>
        <button type="button" onClick={onDismiss} className="text-[12px] text-app-text-secondary hover:text-app-text-primary">
          ביטול
        </button>
      </div>
    </div>
  );
}
