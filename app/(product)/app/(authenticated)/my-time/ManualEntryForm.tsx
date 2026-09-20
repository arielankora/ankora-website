"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { createManualEntryAction } from "./actions";
import { useToast } from "@/components/app/toast/ToastProvider";

type Client = { id: string; name: string };
type Category = { id: string; name: string; clientId: string | null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="shrink-0 rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-navy disabled:opacity-50"
      style={{ marginInlineStart: "auto" }}
    >
      {pending ? "שומר..." : "הוספת דיווח"}
    </button>
  );
}

function todayKey(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
}

// App redesign (handoff README, screen 3 "הזמן שלי"): "הזנה בשורה אחת -
// במקום טופס נפתח" - always visible (no more open/close toggle), and
// laid out with flex-wrap + explicit flex-basis per field rather than a
// fixed-column grid, which the README explicitly calls out as the wrong
// approach here ("אסור grid עם עמודות קבועות - הוא קורס בחלון צר").
export function ManualEntryForm({ clients, categories }: { clients: Client[]; categories: Category[] }) {
  const [state, formAction] = useFormState(createManualEntryAction, {});
  const { showToast } = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [clientId, setClientId] = useState("");
  const [date, setDate] = useState(todayKey());

  const availableCategories = useMemo(
    () => categories.filter((cat) => cat.clientId === null || cat.clientId === clientId),
    [categories, clientId]
  );
  const isBackdated = date !== todayKey();

  useEffect(() => {
    if (!state?.ok) return;
    formRef.current?.reset();
    setClientId("");
    setDate(todayKey());
    showToast({ tone: "success", title: "הדיווח נשמר" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="rounded-2xl border border-lineDark bg-white p-5"
    >
      <p className="mb-3 text-[13px] font-medium text-appNavy">הוספת דיווח - שורה אחת</p>
      <div className="flex flex-wrap items-end gap-2.5">
        <label className="block" style={{ flex: "0 0 150px" }}>
          <span className="mb-1.5 block text-[11px] text-appNavy/55">תאריך</span>
          <input
            type="date"
            name="date"
            required
            max={todayKey()}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-[9px] border border-lineDark bg-white px-2.5 py-2.5 text-[13px] text-appNavy outline-none focus:border-gold"
          />
        </label>
        <label className="block" style={{ flex: "0 0 108px" }}>
          <span className="mb-1.5 block text-[11px] text-appNavy/55">מ־</span>
          <input
            type="time"
            name="startTime"
            required
            className="w-full rounded-[9px] border border-lineDark bg-white px-2.5 py-2.5 text-[13px] text-appNavy outline-none focus:border-gold"
          />
        </label>
        <label className="block" style={{ flex: "0 0 108px" }}>
          <span className="mb-1.5 block text-[11px] text-appNavy/55">עד</span>
          <input
            type="time"
            name="endTime"
            required
            className="w-full rounded-[9px] border border-lineDark bg-white px-2.5 py-2.5 text-[13px] text-appNavy outline-none focus:border-gold"
          />
        </label>
        <label className="block min-w-0" style={{ flex: "1 1 180px" }}>
          <span className="mb-1.5 block text-[11px] text-appNavy/55">לקוח *</span>
          <select
            name="clientId"
            required
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="w-full rounded-[9px] border border-lineDark bg-white px-2.5 py-2.5 text-[13px] text-appNavy outline-none focus:border-gold"
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
          <span className="mb-1.5 block text-[11px] text-appNavy/55">קטגוריה *</span>
          <select
            name="categoryId"
            required
            disabled={!clientId}
            className="w-full rounded-[9px] border border-lineDark bg-white px-2.5 py-2.5 text-[13px] text-appNavy outline-none focus:border-gold disabled:opacity-40"
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
          <span className="mb-1.5 block text-[11px] text-appNavy/55">הערה</span>
          <input
            name="note"
            placeholder="אופציונלי"
            className="w-full rounded-[9px] border border-lineDark bg-white px-2.5 py-2.5 text-[13px] text-appNavy outline-none focus:border-gold"
          />
        </label>
        <SubmitButton />
      </div>

      {isBackdated && (
        <div className="mt-3 flex items-center gap-2.5 rounded-[10px] border border-gold/35 bg-gold/8 px-3 py-2.5">
          <span className="shrink-0 text-[12.5px] text-gold-dim">דיווח ליום קודם - נדרשת סיבה</span>
          <input
            name="backdateReason"
            required
            placeholder="למשל: נשכח לדווח בזמן"
            className="flex-1 rounded-lg border border-lineDark bg-white px-2.5 py-2 text-[13px] text-appNavy outline-none focus:border-gold"
          />
        </div>
      )}
      {state?.error && (
        <p className="mt-3 rounded-[10px] border border-error/30 bg-error-soft px-3 py-2.5 text-[12.5px] text-error">
          {state.error}
        </p>
      )}
    </form>
  );
}
