"use client";
import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { updateMyEntryAction, deleteMyEntryAction } from "./actions";
import { StatusBadge } from "@/components/app/StatusBadge";

type Entry = {
  id: string;
  startAt: string;
  endAt: string | null;
  actualSeconds: number | null;
  note: string | null;
  isEdited: boolean;
  isManual: boolean;
  clientName: string;
  categoryName: string;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full bg-gold-gradient px-4 py-2 text-xs font-medium text-ink disabled:opacity-50"
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
export function EntryRow({ entry }: { entry: Entry }) {
  const [state, formAction] = useFormState(updateMyEntryAction, {});
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <form action={formAction} className="space-y-3 px-5 py-4">
        <input type="hidden" name="timeEntryId" value={entry.id} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <label className="block text-xs font-medium text-navy/60">תאריך</label>
            <input
              type="date"
              name="date"
              defaultValue={dateKeyOf(entry.startAt)}
              required
              className="mt-1 w-full rounded-lg border border-lineDark bg-white px-2.5 py-1.5 text-sm text-navy outline-none focus:border-gold"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-navy/60">התחלה</label>
            <input
              type="time"
              name="startTime"
              defaultValue={timeKey(entry.startAt)}
              required
              className="mt-1 w-full rounded-lg border border-lineDark bg-white px-2.5 py-1.5 text-sm text-navy outline-none focus:border-gold"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-navy/60">סיום</label>
            <input
              type="time"
              name="endTime"
              defaultValue={entry.endAt ? timeKey(entry.endAt) : ""}
              required
              className="mt-1 w-full rounded-lg border border-lineDark bg-white px-2.5 py-1.5 text-sm text-navy outline-none focus:border-gold"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-navy/60">הערה</label>
            <input
              name="note"
              defaultValue={entry.note ?? ""}
              className="mt-1 w-full rounded-lg border border-lineDark bg-white px-2.5 py-1.5 text-sm text-navy outline-none focus:border-gold"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-navy/60">סיבת עריכה (מומלץ)</label>
          <input
            name="reason"
            className="mt-1 w-full rounded-lg border border-lineDark bg-white px-2.5 py-1.5 text-sm text-navy outline-none focus:border-gold sm:w-1/2"
          />
        </div>
        <div className="flex items-center gap-3">
          <SubmitButton />
          <button type="button" onClick={() => setEditing(false)} className="text-xs text-navy/60 hover:text-navy">
            ביטול
          </button>
          {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-navy">
          {timeKey(entry.startAt)}
          {entry.endAt ? ` – ${timeKey(entry.endAt)}` : ""} · {formatDuration(entry.actualSeconds)}
        </p>
        <p className="mt-0.5 text-xs text-navy/60">
          {entry.clientName} · {entry.categoryName}
          {entry.note ? ` · ${entry.note}` : ""}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {entry.isEdited && <StatusBadge label="נערך" tone="amber" />}
        {!entry.isManual && <StatusBadge label="טיימר" tone="gray" />}
        <button type="button" onClick={() => setEditing(true)} className="text-xs text-navy/60 hover:text-navy">
          עריכה
        </button>
        <form action={deleteMyEntryAction}>
          <input type="hidden" name="timeEntryId" value={entry.id} />
          <button type="submit" className="text-xs text-navy/50 hover:text-red-600">
            מחיקה
          </button>
        </form>
      </div>
    </div>
  );
}
