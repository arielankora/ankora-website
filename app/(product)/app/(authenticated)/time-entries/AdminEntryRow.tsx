"use client";
import { useEffect, useRef, useState } from "react";
import { noTranslateProps } from "@/components/app/NoMachineTranslation";
import { useActionForm } from "@/components/app/useActionForm";
import { adminUpdateEntryAction, deleteEntryAction, restoreEntryAction, getEntryRevisionsAction } from "./actions";
import { ClosedBankNotice } from "../my-time/ClosedBankNotice";
import type { ClosedBankNoticeState } from "../my-time/entry-errors";
import { useToast } from "@/components/app/toast/ToastProvider";
import { StatusBadge } from "@/components/app/StatusBadge";
import { formatDuration, sourceKey } from "@/lib/time-entry-format";
import { useFormatter, useTranslations } from "next-intl";

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
  /// ADR 0006: the entry's client or task is "בלי AI", so its row is kept
  /// from the browser's translator.
  aiExcluded?: boolean;
};

type Revision = {
  id: string;
  version: number;
  changedAt: string;
  changedByName: string | null;
  reason: string | null;
  beforeJson: unknown;
  afterJson: unknown;
};

function SubmitButton({ pending }: { pending: boolean }) {
  const t = useTranslations("timeEntriesAdmin.row");
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full bg-app-accent px-4 py-2 text-xs font-medium text-app-text-primary disabled:opacity-50"
    >
      {pending ? t("saving") : t("save")}
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
  const t = useTranslations("timeEntriesAdmin.row");
  const format = useFormatter();
  const formatDateTime = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "short", timeStyle: "short" });
  // 4.11.2026: useActionForm, not `<form action>`. A form action resets
  // the form once it returns, so after the closed-bank notice the edit
  // fields were back to the stored values, and the manager's override
  // resubmitted the old entry unchanged (found by a Cowork run on RIMED).
  const { onSubmit, pending, result: state, error: saveError } = useActionForm(adminUpdateEntryAction);
  const [editing, setEditing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [revisions, setRevisions] = useState<Revision[] | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [deleted, setDeleted] = useState(false);
  // 3.11.2026: an edit or delete in a closed hour bank, and the override.
  const editFormRef = useRef<HTMLFormElement>(null);
  const overrideReasonRef = useRef<HTMLInputElement>(null);
  const [closedDismissed, setClosedDismissed] = useState(false);
  const [deleteClosed, setDeleteClosed] = useState<ClosedBankNoticeState | null>(null);

  async function handleDelete(closedBankOverrideReason?: string) {
    const result = await deleteEntryAction(entry.id, closedBankOverrideReason);
    if (!result.ok) {
      if ("closedBank" in result && result.closedBank) {
        setDeleteClosed(result.closedBank);
        return;
      }
      showToast({ tone: "error", title: t("deleteFailed"), description: result.error });
      return;
    }
    setDeleteClosed(null);
    setDeleted(true);
    showToast({
      tone: "warning",
      title: t("deleted"),
      description: `${entry.userName} · ${entry.clientName}`,
      undo: async () => {
        const restored = await restoreEntryAction(entry.id, closedBankOverrideReason);
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
    if (state?.closedBank) setClosedDismissed(false);
    if ((state?.ok || state?.error) && overrideReasonRef.current) overrideReasonRef.current.value = "";
  }, [state]);

  // Must come after every hook above (rules-of-hooks) - this early return
  // only skips rendering once the row's own delete already succeeded.
  if (deleted) return null;

  // SOURCE_LABEL (lib/time-entry-format.ts) stays Hebrew for the export.
  const source = sourceKey(entry.source);
  const sourceLabel = source ? t(source) : entry.source;

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
      <tr {...noTranslateProps(entry.aiExcluded)} className="border-b border-app-border">
        <td colSpan={9} className="px-5 py-4">
          <form ref={editFormRef} onSubmit={onSubmit} className="space-y-3">
            <input type="hidden" name="timeEntryId" value={entry.id} />
            <input ref={overrideReasonRef} type="hidden" name="closedBankOverrideReason" defaultValue="" />
            <input type="hidden" name="expectedUpdatedAt" value={entry.updatedAt} />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <label className="block text-xs font-medium text-app-text-secondary">{t("date")}</label>
                <input
                  type="date"
                  name="date"
                  defaultValue={dateKeyOf(entry.startAt)}
                  max={todayKey()}
                  required
                  className="mt-1 w-full rounded-lg border border-app-border-strong bg-white px-2.5 py-1.5 text-sm text-app-text-primary outline-none focus:border-gold"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-app-text-secondary">{t("start")}</label>
                <input
                  type="time"
                  name="startTime"
                  defaultValue={timeKey(entry.startAt)}
                  required
                  className="mt-1 w-full rounded-lg border border-app-border-strong bg-white px-2.5 py-1.5 text-sm text-app-text-primary outline-none focus:border-gold"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-app-text-secondary">{t("end")}</label>
                <input
                  type="time"
                  name="endTime"
                  defaultValue={entry.endAt ? timeKey(entry.endAt) : ""}
                  required
                  className="mt-1 w-full rounded-lg border border-app-border-strong bg-white px-2.5 py-1.5 text-sm text-app-text-primary outline-none focus:border-gold"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-app-text-secondary">{t("note")}</label>
                <input
                  name="note"
                  defaultValue={entry.note ?? ""}
                  className="mt-1 w-full rounded-lg border border-app-border-strong bg-white px-2.5 py-1.5 text-sm text-app-text-primary outline-none focus:border-gold"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-xs font-medium text-app-text-secondary">{t("editReason")}</label>
                <input
                  name="reason"
                  className="mt-1 w-full rounded-lg border border-app-border-strong bg-white px-2.5 py-1.5 text-sm text-app-text-primary outline-none focus:border-gold"
                />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id={`override-${entry.id}`} name="allowOverlapOverride" className="h-4 w-4" />
                <label htmlFor={`override-${entry.id}`} className="text-xs text-app-text-secondary">
                  {t("allowOverlap")}
                </label>
              </div>
            </div>
            {state?.closedBank && !closedDismissed && (
              <ClosedBankNotice
                notice={state.closedBank}
                onOverride={(reason) => {
                  if (overrideReasonRef.current) overrideReasonRef.current.value = reason;
                  editFormRef.current?.requestSubmit();
                }}
                onDismiss={() => setClosedDismissed(true)}
              />
            )}
            <div className="flex items-center gap-3">
              <SubmitButton pending={pending} />
              <button type="button" onClick={() => setEditing(false)} className="text-xs text-app-text-secondary hover:text-app-text-primary">
                {t("cancel")}
              </button>
              {saveError && <p className="text-xs text-app-error">{saveError}</p>}
            </div>
          </form>
        </td>
      </tr>
    );
  }

  return (
    <>
      <tr {...noTranslateProps(entry.aiExcluded)} className="border-b border-app-border last:border-0">
        <td className="px-5 py-3">
          <button
            type="button"
            onClick={onToggleSelect}
            aria-label={t("select")}
            className={`flex h-5 w-5 items-center justify-center rounded-md border text-[11px] ${
              selected ? "border-gold bg-app-accent text-app-text-primary" : "border-app-border bg-white text-transparent"
            }`}
          >
            ✓
          </button>
        </td>
        <td className="px-5 py-3 text-app-text-primary">{formatDateTime(entry.startAt)}</td>
        <td className="px-5 py-3 text-app-text-primary">{entry.userName}</td>
        <td dir="auto" className="px-5 py-3 text-app-text-primary">
          {entry.clientName}
        </td>
        <td dir="auto" className="px-5 py-3 text-app-text-primary">
          {entry.categoryName}
        </td>
        <td className="px-5 py-3 text-app-text-primary">
          {entry.actualSeconds === null ? t("active") : formatDuration(entry.actualSeconds)}
        </td>
        <td className="max-w-[220px] px-5 py-3 text-app-text-primary">
          {entry.note ? (
            <span dir="auto" className="line-clamp-2 break-words" title={entry.note}>
              {entry.note}
            </span>
          ) : (
            <span className="text-app-text-tertiary">-</span>
          )}
        </td>
        <td className="px-5 py-3">
          <div className="flex items-center gap-2">
            <StatusBadge label={sourceLabel} tone={entry.source === "TIMER" ? "green" : "gray"} />
            {entry.isEdited && <StatusBadge label={t("edited")} tone="amber" />}
            {entry.isOverlapConfirmed && <StatusBadge label={t("overlapConfirmed")} tone="amber" />}
          </div>
        </td>
        <td className="px-5 py-3 text-end">
          <div className="flex items-center justify-end gap-3">
            <button type="button" onClick={toggleHistory} className="text-xs text-app-text-secondary hover:text-app-text-primary">
              {t("history")}
            </button>
            <button type="button" onClick={() => setEditing(true)} className="text-xs text-app-text-secondary hover:text-app-text-primary">
              {t("edit")}
            </button>
            <button type="button" onClick={() => void handleDelete()} className="text-xs text-app-text-tertiary hover:text-app-error">
              {t("delete")}
            </button>
          </div>
        </td>
      </tr>
      {deleteClosed && (
        <tr className="border-b border-app-border">
          <td colSpan={9} className="px-5 py-3">
            <ClosedBankNotice
              notice={deleteClosed}
              onOverride={(reason) => void handleDelete(reason)}
              onDismiss={() => setDeleteClosed(null)}
            />
          </td>
        </tr>
      )}
      {showHistory && (
        <tr {...noTranslateProps(entry.aiExcluded)} className="border-b border-app-border bg-cream/60">
          <td colSpan={9} className="px-5 py-4">
            {loadingHistory && <p className="text-xs text-app-text-tertiary">{t("loadingHistory")}</p>}
            {!loadingHistory && revisions && revisions.length === 0 && (
              <p className="text-xs text-app-text-tertiary">{t("noHistory")}</p>
            )}
            {!loadingHistory && revisions && revisions.length > 0 && (
              <ul className="space-y-2">
                {revisions.map((rev) => (
                  <li key={rev.id} className="rounded-lg border border-app-border bg-white p-3 text-xs">
                    <p className="font-medium text-app-text-primary">
                      {t("revision", {
                        version: String(rev.version),
                        date: formatDateTime(rev.changedAt),
                        name: rev.changedByName ?? t("system"),
                      })}
                    </p>
                    {rev.reason && <p className="mt-1 text-app-text-secondary">{t("revisionReason", { reason: rev.reason })}</p>}
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
