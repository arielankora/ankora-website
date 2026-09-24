"use client";
import { useMemo, useState } from "react";
import { adminCreateEntryAction } from "./actions";
import { useActionForm } from "@/components/app/useActionForm";
import { useToast } from "@/components/app/toast/ToastProvider";

type Option = { id: string; name: string };
type Category = { id: string; name: string; clientId: string | null };

function SubmitButton({ pending }: { pending: boolean }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-navy disabled:opacity-50"
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
  const [clientId, setClientId] = useState("");
  const [userId, setUserId] = useState("");
  const [date, setDate] = useState(todayKey());
  const [open, setOpen] = useState(false);
  const { showToast } = useToast();
  // Closes on success, like every other create form in the app. It used
  // to stay open and rely on the person noticing the new row appear in
  // the table below - which says nothing when the row is slow to arrive,
  // and nothing at all about whether the write was accepted.
  //
  // And closing alone was not enough either. Collapsing back to a toggle
  // is the same shape as never having opened: the only difference a
  // person could read was a row appearing in a table that is filtered and
  // paged, so on most screens there was nothing to see at all. This form
  // now says so out loud, the way the employee's own screen does - and it
  // names the employee, because filing time against somebody else's name
  // is exactly the case where "saved" is not enough to know it went to
  // the right person.
  const { onSubmit, pending, error } = useActionForm(adminCreateEntryAction, () => {
    setOpen(false);
    const person = users.find((u) => u.id === userId);
    showToast({
      tone: "success",
      title: "הדיווח נשמר",
      description: person ? `נרשם על שם ${person.name}.` : undefined,
    });
    setUserId("");
    setClientId("");
    setDate(todayKey());
  });

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
        className="rounded-full border border-lineDark bg-white px-5 py-2.5 text-sm font-medium text-appNavy hover:border-gold"
      >
        + דיווח עבור עובד
      </button>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid grid-cols-1 gap-4 rounded-2xl border border-lineDark bg-white p-6 sm:grid-cols-2 lg:grid-cols-4"
    >
      <div>
        <label className="block text-xs font-medium text-appNavy/60">עובד *</label>
        <select
          name="userId"
          required
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-appNavy outline-none focus:border-gold"
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
        <label className="block text-xs font-medium text-appNavy/60">תאריך *</label>
        <input
          type="date"
          name="date"
          required
          max={todayKey()}
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-appNavy outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-appNavy/60">שעת התחלה *</label>
        <input
          type="time"
          name="startTime"
          required
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-appNavy outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-appNavy/60">שעת סיום *</label>
        <input
          type="time"
          name="endTime"
          required
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-appNavy outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-appNavy/60">לקוח *</label>
        <select
          name="clientId"
          required
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-appNavy outline-none focus:border-gold"
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
        <label className="block text-xs font-medium text-appNavy/60">קטגוריה *</label>
        <select
          name="categoryId"
          required
          disabled={!clientId}
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-appNavy outline-none focus:border-gold disabled:opacity-40"
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
        <label className="block text-xs font-medium text-appNavy/60">הערה</label>
        <input
          name="note"
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-appNavy outline-none focus:border-gold"
        />
      </div>
      {isBackdated && (
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-appNavy/60">סיבת דיווח ליום קודם *</label>
          <input
            name="backdateReason"
            required
            className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-appNavy outline-none focus:border-gold"
          />
        </div>
      )}
      <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-4">
        <input type="checkbox" id="allowOverlapOverride" name="allowOverlapOverride" className="h-4 w-4" />
        <label htmlFor="allowOverlapOverride" className="text-xs text-appNavy/60">
          לאפשר שמירה גם אם קיימת חפיפה עם דיווח אחר (override)
        </label>
      </div>

      <div className="flex items-end justify-between gap-4 sm:col-span-2 lg:col-span-4">
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="ms-auto flex gap-3">
          <button type="button" onClick={() => setOpen(false)} className="text-sm text-appNavy/60 hover:text-appNavy">
            ביטול
          </button>
          <SubmitButton pending={pending} />
        </div>
      </div>
    </form>
  );
}
