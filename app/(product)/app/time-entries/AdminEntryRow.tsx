"use client";
import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { adminUpdateEntryAction, adminDeleteEntryAction, getEntryRevisionsAction } from "./actions";
import { StatusBadge } from "@/components/app/StatusBadge";

type Entry = {
  id: string;
  startAt: string;
  endAt: string | null;
  actualSeconds: number | null;
  note: string | null;
  isEdited: boolean;
  source: string;
  userName: string;
  clientName: string;
  categoryName: string;
  /// Phase 7 (spec 20 conflict rule) - sent back as expectedUpdatedAt on
  /// save so the server can detect a concurrent edit; see
  /// lib/app-domain/time-entries.ts's ConflictError.
  updatedAt: string;
};

type Revision = {
  id: string;
  version: number;
  changedAt: string;
  changedByName: string;
  reason: string | null;
  beforeJson: unknown;
  afterJson: unknown;
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

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Jerusalem" }).format(
    new Date(iso)
  );
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "פעיל";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

const SOURCE_LABEL: Record<string, string> = { MANUAL: "ידני", TIMER: "טיימר" };

/// Spec 12: Admin "Time Entries" screen needs edit + revisions on a
/// cross-client table. Revisions are lazy-fetched on open (most rows have
/// none) via the getEntryRevisionsAction server action.
export function AdminEntryRow({ entry }: { entry: Entry }) {
  const [state, formAction] = useFormState(adminUpdateEntryAction, {});
  const [editing, setEditing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [revisions, setRevisions] = useState<Revision[] | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  async function toggleHistory() {
    if (showHistory) {
      setShowHistory(false);
      return;
    }
    setShowHistory(true);
    if (revisions === null) {
      setLoadingHistory(true);
      const data = await getEntryRevisionsAction(entry.id);
      setRevisions(data);
      setLoadingHistory(false);
    }
  }

  if (editing) {
    return (
      <tr className="border-b border-lineDark">
        <td colSpan={7} className="px-5 py-4">
          <form action={formAction} className="space-y-3">
            <input type="hidden" name="timeEntryId" value={entry.id} />
            <input type="hidden" name="expectedUpdatedAt" value={entry.updatedAt} />
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
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-xs font-medium text-navy/60">סיבת עריכה</label>
                <input
                  name="reason"
                  className="mt-1 w-full rounded-lg border border-lineDark bg-white px-2.5 py-1.5 text-sm text-navy outline-none focus:border-gold"
                />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id={`override-${entry.id}`} name="allowOverlapOverride" className="h-4 w-4" />
                <label htmlFor={`override-${entry.id}`} className="text-xs text-navy/60">
                  אפשר חפיפה (override)
                </label>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <SubmitButton />
              <button type="button" onClick={() => setEditing(false)} className="text-xs text-navy/60 hover:text-navy">
                ביטול
              </button>
              {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
            </div>
          </form>
        </td>
      </tr>
    );
  }

  return (
    <>
      <tr className="border-b border-lineDark last:border-0">
        <td className="px-5 py-3 text-navy/80">{formatDateTime(entry.startAt)}</td>
        <td className="px-5 py-3 text-navy/80">{entry.userName}</td>
        <td className="px-5 py-3 text-navy/80">{entry.clientName}</td>
        <td className="px-5 py-3 text-navy/80">{entry.categoryName}</td>
        <td className="px-5 py-3 text-navy/80">{formatDuration(entry.actualSeconds)}</td>
        <td className="px-5 py-3">
          <div className="flex items-center gap-2">
            <StatusBadge label={SOURCE_LABEL[entry.source] ?? entry.source} tone="gray" />
            {entry.isEdited && <StatusBadge label="נערך" tone="amber" />}
          </div>
        </td>
        <td className="px-5 py-3 text-end">
          <div className="flex items-center justify-end gap-3">
            <button type="button" onClick={toggleHistory} className="text-xs text-navy/60 hover:text-navy">
              היסטוריה
            </button>
            <button type="button" onClick={() => setEditing(true)} className="text-xs text-navy/60 hover:text-navy">
              עריכה
            </button>
            <form action={adminDeleteEntryAction}>
              <input type="hidden" name="timeEntryId" value={entry.id} />
              <button type="submit" className="text-xs text-navy/50 hover:text-red-600">
                מחיקה
              </button>
            </form>
          </div>
        </td>
      </tr>
      {showHistory && (
        <tr className="border-b border-lineDark bg-paper/60">
          <td colSpan={7} className="px-5 py-4">
            {loadingHistory && <p className="text-xs text-navy/50">טוען היסטוריה...</p>}
            {!loadingHistory && revisions && revisions.length === 0 && (
              <p className="text-xs text-navy/50">אין עריכות קודמות לדיווח זה.</p>
            )}
            {!loadingHistory && revisions && revisions.length > 0 && (
              <ul className="space-y-2">
                {revisions.map((rev) => (
                  <li key={rev.id} className="rounded-lg border border-lineDark bg-white p-3 text-xs">
                    <p className="font-medium text-navy">
                      גרסה {rev.version} · {formatDateTime(rev.changedAt)} · {rev.changedByName}
                    </p>
                    {rev.reason && <p className="mt-1 text-navy/60">סיבה: {rev.reason}</p>}
                  </li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
