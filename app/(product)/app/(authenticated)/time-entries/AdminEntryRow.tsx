"use client";
import { useEffect, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { adminUpdateEntryAction, deleteEntryAction, restoreEntryAction, getEntryRevisionsAction } from "./actions";
import { useToast } from "@/components/app/toast/ToastProvider";
import { StatusBadge } from "@/components/app/StatusBadge";
import { formatDuration, SOURCE_LABEL } from "@/lib/time-entry-format";

function todayKey(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
}

export type Entry = {
  id: string;
  startAt: string;
  endAt: string | null;
  actualSeconds: number | null;
  note: string | null;
  isEdited: boolean;
  /// Phase 12 (spec "אישור דיווח שעות חופף בין לקוחות שונים"): true when
  /// this save only went through because a conflicting entry was
  /// overridden via the "אפשר חפיפה (override)" checkbox below - includes
  /// a same-client override, which only this admin path can do.
  isOverlapConfirmed: boolean;
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

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Jerusalem" }).format(
    new Date(iso)
  );
}

/// Spec 12: Admin "Time Entries" screen needs edit + revisions on a
/// cross-client table. Revisions are lazy-fetched on open (most rows have
/// none) via the getEntryRevisionsAction server action.
///
/// App redesign (handoff README, screen 9): the prototype's row is simpler
/// (checkbox + title/meta + employee + source badge + duration, no visible
/// edit/history/delete). Those three actions are core to spec 12 ("Time
/// Entries - cross-client table + filters + edits + revisions") and have no
/// equivalent anywhere else in the app, so they're kept as trailing text
/// actions rather than dropped - same judgment call as Phase 4's Clients
/// screen keeping real data the prototype simplified away, just for
/// actions instead of data.
export function AdminEntryRow({
  entry,
  selected,
  onToggleSelect,
}: {
  entry: Entry;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const { showToast } = useToast();
  const [state, formAction] = useFormState(adminUpdateEntryAction, {});
  const [editing, setEditing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [revisions, setRevisions] = useState<Revision[] | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [deleted, setDeleted] = useState(false);

  async function handleDelete() {
    const result = await deleteEntryAction(entry.id);
    if (!result.ok) {
      showToast({ tone: "error", title: "המחיקה נכשלה", description: result.error });
      return;
    }
    setDeleted(true);
    showToast({
      tone: "warning",
      title: "הדיווח נמחק",
      description: `${entry.userName} · ${entry.clientName}`,
      undo: async () => {
        const restored = await restoreEntryAction(entry.id);
        if (restored.ok) setDeleted(false);
      },
    });
  }

  // Bug fix (docs/adr/0001 section 19.12) - same issue as my-time/
  // EntryRow.tsx: adminUpdateEntryAction returns { ok: true } on success
  // but this component never read state.ok, so a successful save left
  // the edit form open with stale values and no visible confirmation.
  useEffect(() => {
    if (state?.ok) setEditing(false);
  }, [state]);

  // Must come after every hook above (rules-of-hooks) - this early return
  // only skips rendering once the row's own delete already succeeded.
  if (deleted) return null;

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
        <td colSpan={9} className="px-5 py-4">
          <form action={formAction} className="space-y-3">
            <input type="hidden" name="timeEntryId" value={entry.id} />
            <input type="hidden" name="expectedUpdatedAt" value={entry.updatedAt} />
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
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-xs font-medium text-appNavy/60">סיבת עריכה</label>
                <input
                  name="reason"
                  className="mt-1 w-full rounded-lg border border-lineDark bg-white px-2.5 py-1.5 text-sm text-appNavy outline-none focus:border-gold"
                />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id={`override-${entry.id}`} name="allowOverlapOverride" className="h-4 w-4" />
                <label htmlFor={`override-${entry.id}`} className="text-xs text-appNavy/60">
                  אפשר חפיפה (override)
                </label>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <SubmitButton />
              <button type="button" onClick={() => setEditing(false)} className="text-xs text-appNavy/60 hover:text-appNavy">
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
        <td className="px-5 py-3">
          <button
            type="button"
            onClick={onToggleSelect}
            aria-label="בחירה"
            className={`flex h-5 w-5 items-center justify-center rounded-md border text-[11px] ${
              selected ? "border-gold bg-gold-gradient text-navy" : "border-lineDark bg-white text-transparent"
            }`}
          >
            ✓
          </button>
        </td>
        <td className="px-5 py-3 text-appNavy/80">{formatDateTime(entry.startAt)}</td>
        <td className="px-5 py-3 text-appNavy/80">{entry.userName}</td>
        <td className="px-5 py-3 text-appNavy/80">{entry.clientName}</td>
        <td className="px-5 py-3 text-appNavy/80">{entry.categoryName}</td>
        <td className="px-5 py-3 text-appNavy/80">{formatDuration(entry.actualSeconds)}</td>
        <td className="max-w-[220px] px-5 py-3 text-appNavy/80">
          {entry.note ? (
            <span className="line-clamp-2 break-words" title={entry.note}>
              {entry.note}
            </span>
          ) : (
            <span className="text-appNavy/30">—</span>
          )}
        </td>
        <td className="px-5 py-3">
          <div className="flex items-center gap-2">
            <StatusBadge label={SOURCE_LABEL[entry.source] ?? entry.source} tone={entry.source === "TIMER" ? "green" : "gray"} />
            {entry.isEdited && <StatusBadge label="נערך" tone="amber" />}
            {entry.isOverlapConfirmed && <StatusBadge label="חפיפה מאושרת" tone="amber" />}
          </div>
        </td>
        <td className="px-5 py-3 text-end">
          <div className="flex items-center justify-end gap-3">
            <button type="button" onClick={toggleHistory} className="text-xs text-appNavy/60 hover:text-appNavy">
              היסטוריה
            </button>
            <button type="button" onClick={() => setEditing(true)} className="text-xs text-appNavy/60 hover:text-appNavy">
              עריכה
            </button>
            <button type="button" onClick={handleDelete} className="text-xs text-appNavy/50 hover:text-red-600">
              מחיקה
            </button>
          </div>
        </td>
      </tr>
      {showHistory && (
        <tr className="border-b border-lineDark bg-cream/60">
          <td colSpan={9} className="px-5 py-4">
            {loadingHistory && <p className="text-xs text-appNavy/50">טוען היסטוריה...</p>}
            {!loadingHistory && revisions && revisions.length === 0 && (
              <p className="text-xs text-appNavy/50">אין עריכות קודמות לדיווח זה.</p>
            )}
            {!loadingHistory && revisions && revisions.length > 0 && (
              <ul className="space-y-2">
                {revisions.map((rev) => (
                  <li key={rev.id} className="rounded-lg border border-lineDark bg-white p-3 text-xs">
                    <p className="font-medium text-appNavy">
                      גרסה {rev.version} · {formatDateTime(rev.changedAt)} · {rev.changedByName}
                    </p>
                    {rev.reason && <p className="mt-1 text-appNavy/60">סיבה: {rev.reason}</p>}
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
