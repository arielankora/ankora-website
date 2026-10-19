"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createManualEntryAction } from "./actions";
import { useActionForm } from "@/components/app/useActionForm";
import { useToast } from "@/components/app/toast/ToastProvider";

type Client = { id: string; name: string };
type Category = { id: string; name: string; clientId: string | null };

function SubmitButton({ pending }: { pending: boolean }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="shrink-0 rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50"
      style={{ marginInlineStart: "auto" }}
    >
      {pending ? "שומר..." : "הוספת דיווח"}
    </button>
  );
}

function formatTimeRange(startIso: string, endIso: string | null): string {
  const fmt = new Intl.DateTimeFormat("he-IL", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jerusalem" });
  const start = fmt.format(new Date(startIso));
  if (!endIso) return `${start} (טיימר פעיל)`;
  return `${start}\u2013${fmt.format(new Date(endIso))}`;
}

function todayKey(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
}

// App redesign (handoff README, screen 3 "הזמן שלי"): "הזנה בשורה אחת -
// במקום טופס נפתח" - always visible (no more open/close toggle), and
// laid out with flex-wrap + explicit flex-basis per field rather than a
// fixed-column grid, which the README explicitly calls out as the wrong
// approach here ("אסור grid עם עמודות קבועות - הוא קורס בחלון צר").
//
// Spec "אישור דיווח שעות חופף בין לקוחות שונים": a cross-client overlap comes
// back from the server action as `overlapWarning`, not `error` - shown here as a
// dismissible, non-fatal notice with a "שמירה בכל זאת" button that resubmits the
// exact same form data plus a hidden confirmOverlap flag, so nothing has to be
// re-entered. A same-client overlap still comes back as the existing hard `error`
// and is never offered this choice.
export function ManualEntryForm({ clients, categories }: { clients: Client[]; categories: Category[] }) {
  const { onSubmit, pending, result } = useActionForm(createManualEntryAction);
  const { showToast } = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [clientId, setClientId] = useState("");
  const [date, setDate] = useState(todayKey());
  const [warningDismissed, setWarningDismissed] = useState(false);
  const confirmOverlapRef = useRef<HTMLInputElement>(null);

  const availableCategories = useMemo(
    () => categories.filter((cat) => cat.clientId === null || cat.clientId === clientId),
    [categories, clientId]
  );
  const isBackdated = date !== todayKey();

  useEffect(() => {
    if (result?.overlapWarning) setWarningDismissed(false);
    // The hidden flag is sticky across submits (it is a ref, not form state), so
    // it has to be cleared once a save succeeds - otherwise the NEXT entry would
    // silently confirm an overlap nobody was shown.
    if (confirmOverlapRef.current && (result?.ok || result?.error)) confirmOverlapRef.current.value = "false";
    if (!result?.ok) return;
    formRef.current?.reset();
    setClientId("");
    setDate(todayKey());
    showToast({ tone: "success", title: "הדיווח נשמר" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  function saveAnyway() {
    if (confirmOverlapRef.current) confirmOverlapRef.current.value = "true";
    formRef.current?.requestSubmit();
  }

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      className="rounded-2xl border border-app-border bg-white p-5"
    >
      <input ref={confirmOverlapRef} type="hidden" name="confirmOverlap" defaultValue="false" />
      <p className="mb-3 text-[13px] font-medium text-app-text-primary">הוספת דיווח - שורה אחת</p>
      <div className="flex flex-wrap items-end gap-2.5">
        <label className="block" style={{ flex: "0 0 150px" }}>
          <span className="mb-1.5 block text-[11px] text-app-text-secondary">תאריך</span>
          <input
            type="date"
            name="date"
            required
            max={todayKey()}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-[9px] border border-app-border-strong bg-white px-2.5 py-2.5 text-[13px] text-app-text-primary outline-none focus:border-gold"
          />
        </label>
        <label className="block" style={{ flex: "0 0 108px" }}>
          <span className="mb-1.5 block text-[11px] text-app-text-secondary">מ־</span>
          <input
            type="time"
            name="startTime"
            required
            className="w-full rounded-[9px] border border-app-border-strong bg-white px-2.5 py-2.5 text-[13px] text-app-text-primary outline-none focus:border-gold"
          />
        </label>
        <label className="block" style={{ flex: "0 0 108px" }}>
          <span className="mb-1.5 block text-[11px] text-app-text-secondary">עד</span>
          <input
            type="time"
            name="endTime"
            required
            className="w-full rounded-[9px] border border-app-border-strong bg-white px-2.5 py-2.5 text-[13px] text-app-text-primary outline-none focus:border-gold"
          />
        </label>
        <label className="block min-w-0" style={{ flex: "1 1 180px" }}>
          <span className="mb-1.5 block text-[11px] text-app-text-secondary">לקוח *</span>
          <select
            name="clientId"
            required
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="w-full rounded-[9px] border border-app-border-strong bg-white px-2.5 py-2.5 text-[13px] text-app-text-primary outline-none focus:border-gold"
          >
            <option value="">בחירה</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block min-w-0" style={{ flex: "1 1 140px" }}>
          <span className="mb-1.5 block text-[11px] text-app-text-secondary">קטגוריה *</span>
          <select
            name="categoryId"
            required
            disabled={!clientId}
            className="w-full rounded-[9px] border border-app-border-strong bg-white px-2.5 py-2.5 text-[13px] text-app-text-primary outline-none focus:border-gold disabled:opacity-40"
          >
            <option value="">בחירה</option>
            {availableCategories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block min-w-0" style={{ flex: "1 1 200px" }}>
          <span className="mb-1.5 block text-[11px] text-app-text-secondary">הערה *</span>
          <input
            name="note"
            required
            placeholder="מה נעשה עבור הלקוח?"
            className="w-full rounded-[9px] border border-app-border-strong bg-white px-2.5 py-2.5 text-[13px] text-app-text-primary outline-none focus:border-gold"
          />
        </label>
        <SubmitButton pending={pending} />
      </div>

      {isBackdated && (
        <div className="mt-3 flex items-center gap-2.5 rounded-[10px] border border-gold/35 bg-gold/8 px-3 py-2.5">
          <span className="shrink-0 text-[12.5px] text-app-text-accent">דיווח ליום קודם - נדרשת סיבה</span>
          <input
            name="backdateReason"
            required
            placeholder="למשל: נשכח לדווח בזמן"
            className="flex-1 rounded-lg border border-app-border-strong bg-white px-2.5 py-2 text-[13px] text-app-text-primary outline-none focus:border-gold"
          />
        </div>
      )}
      {result?.overlapWarning && !warningDismissed && (
        <div className="mt-3 rounded-[10px] border border-app-warning/35 bg-app-warning-soft px-3 py-2.5 text-[12.5px] text-app-warning">
          <p>
            קיים כבר דיווח בשעה זו עבור {result.overlapWarning.clientName} (
            {formatTimeRange(result.overlapWarning.startAt, result.overlapWarning.endAt)}). דיווח מקביל אפשרי
            רק כשמדובר בלקוחות שונים - אם אכן כך, אפשר לשמור בכל זאת.
          </p>
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={saveAnyway}
              className="rounded-full border border-app-warning/45 px-3.5 py-1.5 text-[12px] font-medium text-app-warning hover:bg-app-warning-soft"
            >
              שמירה בכל זאת
            </button>
            <button
              type="button"
              onClick={() => setWarningDismissed(true)}
              className="text-[12px] text-app-text-secondary hover:text-app-text-primary"
            >
              ביטול
            </button>
          </div>
        </div>
      )}
      {result?.error && (
        <p className="mt-3 rounded-[10px] border border-app-error/30 bg-app-error-soft px-3 py-2.5 text-[12.5px] text-app-error">
          {result.error}
        </p>
      )}
    </form>
  );
}
