"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { createManualEntryAction } from "./actions";

type Client = { id: string; name: string };
type Category = { id: string; name: string; clientId: string | null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-ink disabled:opacity-50"
    >
      {pending ? "שומר..." : "הוספת דיווח"}
    </button>
  );
}

function todayKey(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
}

function formatTimeRange(startIso: string, endIso: string | null): string {
  const fmt = new Intl.DateTimeFormat("he-IL", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jerusalem" });
  const start = fmt.format(new Date(startIso));
  if (!endIso) return `${start} (טיימר פעיל)`;
  return `${start}–${fmt.format(new Date(endIso))}`;
}

// Spec 6.3 "דיווח ידני": date + start/end, mandatory client+category,
// backdate reason required beyond today (enforced server-side too -
// lib/app-domain/time-entries.ts's BackdateReasonRequiredError).
//
// Spec "אישור דיווח שעות חופף בין לקוחות שונים" (Phase 12): a cross-client
// overlap comes back from the server action as `overlapWarning`, not
// `error` - this form shows it as a dismissible, non-fatal notice with a
// "שמירה בכל זאת" button that resubmits the exact same form data plus a
// hidden confirmOverlap flag, rather than making the person re-enter
// anything. A same-client overlap still comes back as the existing hard
// `error` and is never offered this choice.
export function ManualEntryForm({ clients, categories }: { clients: Client[]; categories: Category[] }) {
  const [state, formAction] = useFormState(createManualEntryAction, {});
  const [clientId, setClientId] = useState("");
  const [date, setDate] = useState(todayKey());
  const [open, setOpen] = useState(false);
  const [warningDismissed, setWarningDismissed] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const confirmOverlapRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state?.overlapWarning) setWarningDismissed(false);
    if (state?.ok && confirmOverlapRef.current) confirmOverlapRef.current.value = "false";
  }, [state]);

  const availableCategories = useMemo(
    () => categories.filter((cat) => cat.clientId === null || cat.clientId === clientId),
    [categories, clientId]
  );
  const isBackdated = date !== todayKey();

  function saveAnyway() {
    if (confirmOverlapRef.current) confirmOverlapRef.current.value = "true";
    formRef.current?.requestSubmit();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full border border-lineDark bg-white px-5 py-2.5 text-sm font-medium text-navy hover:border-gold"
      >
        + דיווח ידני
      </button>
    );
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      className="grid grid-cols-1 gap-4 rounded-2xl border border-lineDark bg-white p-6 sm:grid-cols-2 lg:grid-cols-4"
    >
      <input ref={confirmOverlapRef} type="hidden" name="confirmOverlap" defaultValue="false" />
      <div>
        <label className="block text-xs font-medium text-navy/60">תאריך *</label>
        <input
          type="date"
          name="date"
          required
          max={todayKey()}
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-navy/60">שעת התחלה *</label>
        <input
          type="time"
          name="startTime"
          required
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-navy/60">שעת סיום *</label>
        <input
          type="time"
          name="endTime"
          required
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-navy/60">לקוח *</label>
        <select
          name="clientId"
          required
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        >
          <option value="">בחירה</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-navy/60">קטגוריה *</label>
        <select
          name="categoryId"
          required
          disabled={!clientId}
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold disabled:opacity-40"
        >
          <option value="">בחירה</option>
          {availableCategories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.name}
            </option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-2 lg:col-span-2">
        <label className="block text-xs font-medium text-navy/60">הערה</label>
        <input
          name="note"
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        />
      </div>
      {isBackdated && (
        <div className="sm:col-span-2 lg:col-span-2">
          <label className="block text-xs font-medium text-navy/60">סיבת דיווח ליום קודם *</label>
          <input
            name="backdateReason"
            required
            className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
          />
        </div>
      )}

      {state?.overlapWarning && !warningDismissed && (
        <div className="sm:col-span-2 lg:col-span-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p>
            קיים כבר דיווח בשעה זו עבור {state.overlapWarning.clientName} (
            {formatTimeRange(state.overlapWarning.startAt, state.overlapWarning.endAt)}). ניתן לדווח על עבודה
            מקבילה רק כשמדובר בלקוחות שונים - אם אכן כך, ניתן לשמור בכל זאת.
          </p>
          <div className="mt-2 flex gap-3">
            <button
              type="button"
              onClick={saveAnyway}
              className="rounded-full bg-amber-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
            >
              שמירה בכל זאת
            </button>
            <button
              type="button"
              onClick={() => setWarningDismissed(true)}
              className="text-xs text-amber-800/70 hover:text-amber-900"
            >
              ביטול
            </button>
          </div>
        </div>
      )}

      <div className="flex items-end justify-between gap-4 sm:col-span-2 lg:col-span-4">
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        <div className="ms-auto flex gap-3">
          <button type="button" onClick={() => setOpen(false)} className="text-sm text-navy/60 hover:text-navy">
            ביטול
          </button>
          <SubmitButton />
        </div>
      </div>
    </form>
  );
}
