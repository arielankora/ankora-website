"use client";
import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { updateMyEntryAction, deleteMyEntryAction } from "./actions";
import { StatusBadge } from "@/components/app/StatusBadge";

function todayKey(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
}

function formatTimeRange(startIso: string, endIso: string | null): string {
  const fmt = new Intl.DateTimeFormat("he-IL", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jerusalem" });
  const start = fmt.format(new Date(startIso));
  if (!endIso) return `${start} (טיימר פעיל)`;
  return `${start}–${fmt.format(new Date(endIso))}`;
}

type Entry = {
  id: string;
  startAt: string;
  endAt: string | null;
  actualSeconds: number | null;
  note: string | null;
  isEdited: boolean;
  isManual: boolean;
  /// Phase 12 (spec "אישור דיווח שעות חופף בין לקוחות שונים"): true once
  /// this entry's overlap with another entry (for a different client) was
  /// explicitly confirmed past the warning below.
  isOverlapConfirmed: boolean;
  clientName: string;
  categoryName: string;
  /// Phase 7 (spec 20 conflict rule) - sent back as expectedUpdatedAt on
  /// save so the server can detect a concurrent edit; see
  /// lib/app-domain/time-entries.ts's ConflictError.
  updatedAt: string;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full bg-gold-gradient px-4 py-2 text-xs font-medium text-navy disabled:opacity-50"
    >
      {pending ? "שומר..." : "שמירה"}
    </button>
  );
}

function timeKey(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Jerusalem",
  }).format(new Date(iso));
}

function dateKeyOf(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date(iso));
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "פעיל";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

/// Spec 6.4: "כל עריכה ידנית מסומנת באייקון פנימי 'Edited'." Edit window
/// enforcement itself lives server-side in updateTimeEntry - this form
/// simply surfaces whatever error that throws (EditWindowExpiredError).
///
/// Spec "אישור דיווח שעות חופף בין לקוחות שונים" (Phase 12): editing an
/// entry's time into a cross-client conflict surfaces `overlapWarning`
/// instead of `error` - shown inline with a "שמירה בכל זאת" choice that
/// resubmits the same edit plus a confirmation flag. A same-client
/// conflict is still the existing hard `error`.
export function EntryRow({ entry }: { entry: Entry }) {
  const [state, formAction] = useFormState(updateMyEntryAction, {});
  const [editing, setEditing] = useState(false);
  const [warningDismissed, setWarningDismissed] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const confirmOverlapRef = useRef<HTMLInputElement>(null);

  // Bug fix (docs/adr/0001 section 19.12, live report from Ariel: "clicking
  // save gives no indication anything happened"). updateMyEntryAction
  // always returned { ok: true } on success, but this component never
  // read state.ok - only state.error was rendered, so a successful save
  // left the edit form open with its original (now stale) defaultValue
  // inputs and no visible change at all. Closing the form on success is
  // the fix: revalidatePath() has already refreshed the server-rendered
  // entry, so collapsing back to the display view immediately shows the
  // new saved values - an unambiguous, honest signal that the save
  // worked, instead of a toast that could lie if the save silently failed
  // to persist for some other reason.
  useEffect(() => {
    if (state?.ok) setEditing(false);
    if (state?.overlapWarning) setWarningDismissed(false);
    // A confirmation belongs to the submission it was given for. The flag lives
    // in a ref, so it survives a re-submit; clear it whenever the server comes
    // back with a plain error, or the next attempt would carry a consent the
    // person was never asked for again.
    if (state?.error && confirmOverlapRef.current) confirmOverlapRef.current.value = "false";
  }, [state]);

  function saveAnyway() {
    if (confirmOverlapRef.current) confirmOverlapRef.current.value = "true";
    formRef.current?.requestSubmit();
  }

  if (editing) {
    return (
      <form ref={formRef} action={formAction} className="space-y-3 px-5 py-4">
        <input type="hidden" name="timeEntryId" value={entry.id} />
        <input type="hidden" name="expectedUpdatedAt" value={entry.updatedAt} />
        <input ref={confirmOverlapRef} type="hidden" name="confirmOverlap" defaultValue="false" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <label className="block text-xs font-medium text-appNavy/60">תאריך</label>
            <input
              type="date"
              name="date"
              defaultValue={dateKeyOf(entry.startAt)}
              max={todayKey()}
              required
              className="mt-1 w-full rounded-lg border border-lineDark bg-white px-2.5 py-1.5 text-sm text-appNavy outline-none focus:border-gold"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-appNavy/60">התחלה</label>
            <input
              type="time"
              name="startTime"
              defaultValue={timeKey(entry.startAt)}
              required
              className="mt-1 w-full rounded-lg border border-lineDark bg-white px-2.5 py-1.5 text-sm text-appNavy outline-none focus:border-gold"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-appNavy/60">סיום</label>
            <input
              type="time"
              name="endTime"
              defaultValue={entry.endAt ? timeKey(entry.endAt) : ""}
              required
              className="mt-1 w-full rounded-lg border border-lineDark bg-white px-2.5 py-1.5 text-sm text-appNavy outline-none focus:border-gold"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-appNavy/60">הערה</label>
            <input
              name="note"
              defaultValue={entry.note ?? ""}
              className="mt-1 w-full rounded-lg border border-lineDark bg-white px-2.5 py-1.5 text-sm text-appNavy outline-none focus:border-gold"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-appNavy/60">סיבת עריכה (מומלץ)</label>
          <input
            name="reason"
            className="mt-1 w-full rounded-lg border border-lineDark bg-white px-2.5 py-1.5 text-sm text-appNavy outline-none focus:border-gold sm:w-1/2"
          />
        </div>
        {state?.overlapWarning && !warningDismissed && (
          <div className="rounded-[10px] border border-warning/35 bg-warning-soft px-3 py-2.5 text-xs text-warning">
            <p>
              קיים כבר דיווח בשעה זו עבור {state.overlapWarning.clientName} (
              {formatTimeRange(state.overlapWarning.startAt, state.overlapWarning.endAt)}). דיווח מקביל אפשרי
              רק כשמדובר בלקוחות שונים - אם אכן כך, אפשר לשמור בכל זאת.
            </p>
            <div className="mt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={saveAnyway}
                className="rounded-full border border-warning/45 px-3 py-1 text-xs font-medium text-warning hover:bg-warning/10"
              >
                שמירה בכל זאת
              </button>
              <button
                type="button"
                onClick={() => setWarningDismissed(true)}
                className="text-xs text-appNavy/55 hover:text-appNavy"
              >
                ביטול
              </button>
            </div>
          </div>
        )}
        <div className="flex items-center gap-3">
          <SubmitButton />
          <button type="button" onClick={() => setEditing(false)} className="text-xs text-appNavy/60 hover:text-appNavy">
            ביטול
          </button>
          {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
        </div>
      </form>
    );
  }

  return (
    // App redesign (handoff README, screen 3): "פס זהב אנכי 3px לכל שורה
    // וכפתור עריכה" - the vertical bar plus a bordered pill edit button,
    // replacing the plain text link.
    <div className="flex flex-wrap items-center gap-3.5 px-4 py-3.5">
      <span className="h-[34px] w-[3px] shrink-0 rounded-full bg-gold/60" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] text-appNavy">
          {entry.note || `${entry.clientName} · ${entry.categoryName}`}
        </p>
        <p className="mt-0.5 truncate text-[11.5px] text-appNavy/50">
          {entry.clientName} · {entry.categoryName} · {timeKey(entry.startAt)}
          {entry.endAt ? `–${timeKey(entry.endAt)}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        {entry.isEdited && <StatusBadge label="נערך" tone="amber" />}
        {entry.isOverlapConfirmed && <StatusBadge label="חפיפה מאושרת" tone="amber" />}
        {!entry.isManual && <StatusBadge label="טיימר" tone="gray" />}
        <span className="font-jbmono text-[13.5px] text-appNavy">{formatDuration(entry.actualSeconds)}</span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded-lg border border-lineDark px-3 py-1.5 text-xs text-appNavy/70 hover:border-gold hover:text-appNavy"
        >
          עריכה
        </button>
        <form action={deleteMyEntryAction}>
          <input type="hidden" name="timeEntryId" value={entry.id} />
          <button type="submit" className="text-xs text-appNavy/50 hover:text-error">
            מחיקה
          </button>
        </form>
      </div>
    </div>
  );
}
