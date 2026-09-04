"use client";
import { useMemo, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { adminCreateEntryAction } from "./actions";

type Option = { id: string; name: string };
type Category = { id: string; name: string; clientId: string | null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-ink disabled:opacity-50"
    >
      {pending ? "שומר..." : "הוספת דיווח לעובד"}
    </button>
  );
}

function todayKey(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
}

/// Spec 6.3: "אם אדמין מזין עבור עובד אחר, actor שונה מ-user_id ונרשם
/// ב-Audit." The overlap-override checkbox exists because an admin
/// resolving a dispute may legitimately need to push through a flagged
/// overlap (spec 6.3: "אפשר override רק למי שיש permission") - the server
/// still checks the admin actually holds time_entry.edit_others.
export function AdminCreateEntryForm({
  users,
  clients,
  categories,
}: {
  users: Option[];
  clients: Option[];
  categories: Category[];
}) {
  const [state, formAction] = useFormState(adminCreateEntryAction, {});
  const [clientId, setClientId] = useState("");
  const [date, setDate] = useState(todayKey());
  const [open, setOpen] = useState(false);

  const availableCategories = useMemo(
    () => categories.filter((cat) => cat.clientId === null || cat.clientId === clientId),
    [categories, clientId]
  );
  const isBackdated = date !== todayKey();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full border border-lineDark bg-white px-5 py-2.5 text-sm font-medium text-navy hover:border-gold"
      >
        + דיווח עבור עובד
      </button>
    );
  }

  return (
    <form
      action={formAction}
      className="grid grid-cols-1 gap-4 rounded-2xl border border-lineDark bg-white p-6 sm:grid-cols-2 lg:grid-cols-4"
    >
      <div>
        <label className="block text-xs font-medium text-navy/60">עובד *</label>
        <select
          name="userId"
          required
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        >
          <option value="">בחירה</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-navy/60">תאריך *</label>
        <input
          type="date"
          name="date"
          required
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
      <div className="sm:col-span-2">
        <label className="block text-xs font-medium text-navy/60">הערה</label>
        <input
          name="note"
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        />
      </div>
      {isBackdated && (
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-navy/60">סיבת דיווח ליום קודם *</label>
          <input
            name="backdateReason"
            required
            className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
          />
        </div>
      )}
      <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-4">
        <input type="checkbox" id="allowOverlapOverride" name="allowOverlapOverride" className="h-4 w-4" />
        <label htmlFor="allowOverlapOverride" className="text-xs text-navy/60">
          לאפשר שמירה גם אם קיימת חפיפה עם דיווח אחר (override)
        </label>
      </div>

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
