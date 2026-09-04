"use client";
import { useEffect, useMemo, useState } from "react";
import { startTimerAction, stopTimerAction } from "./actions";
import { StatusBadge } from "@/components/app/StatusBadge";

type Client = { id: string; name: string };
type Category = { id: string; name: string; clientId: string | null };
type Recent = { clientId: string; clientName: string; categoryId: string; categoryName: string };
type ActiveTimer = {
  id: string;
  startAt: string; // ISO - server Date serialized across the RSC boundary
  clientId: string;
  categoryId: string;
  note: string | null;
} | null;

// Spec 6.1: "אם הטיימר רץ זמן חריג (למשל 8/12 שעות configurable) המערכת
// מציגה warning [...] אך לא עוצרת אוטומטית."
const LONG_TIMER_WARNING_SECONDS = 8 * 3600;

function formatElapsed(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

export function TimerWidget({
  activeTimer,
  clients,
  categories,
  recent,
}: {
  activeTimer: ActiveTimer;
  clients: Client[];
  categories: Category[];
  recent: Recent[];
}) {
  const [active, setActive] = useState(activeTimer);
  const [clientId, setClientId] = useState(activeTimer?.clientId ?? "");
  const [categoryId, setCategoryId] = useState(activeTimer?.categoryId ?? "");
  const [note, setNote] = useState(activeTimer?.note ?? "");
  const [elapsed, setElapsed] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showStopConfirm, setShowStopConfirm] = useState(false);

  useEffect(() => {
    if (!active) return;
    const startMs = new Date(active.startAt).getTime();
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - startMs) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [active]);

  const availableCategories = useMemo(
    () => categories.filter((cat) => cat.clientId === null || cat.clientId === clientId),
    [categories, clientId]
  );

  async function handleStart() {
    setError(null);
    if (!clientId || !categoryId) {
      setError("יש לבחור לקוח וקטגוריה.");
      return;
    }
    setPending(true);
    const result = await startTimerAction({ clientId, categoryId, note });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setActive({
      id: result.entry.id,
      startAt: new Date(result.entry.startAt).toISOString(),
      clientId: result.entry.clientId,
      categoryId: result.entry.categoryId,
      note: result.entry.note,
    });
  }

  async function handleStop() {
    if (!active) return;
    setPending(true);
    setError(null);
    const result = await stopTimerAction({ timeEntryId: active.id, note });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setActive(null);
    setShowStopConfirm(false);
    setElapsed(0);
  }

  function pickRecent(r: Recent) {
    setClientId(r.clientId);
    setCategoryId(r.categoryId);
  }

  const activeClient = clients.find((c) => c.id === active?.clientId);
  const activeCategory = categories.find((c) => c.id === active?.categoryId);
  const isLongRunning = elapsed > LONG_TIMER_WARNING_SECONDS;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-lineDark bg-white p-6 md:p-8">
        {active ? (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-navy/50">טיימר פעיל</p>
                <p className="mt-1 text-4xl font-semibold tabular-nums text-navy md:text-5xl">
                  {formatElapsed(elapsed)}
                </p>
              </div>
              {isLongRunning && <StatusBadge label="הטיימר רץ זמן ארוך" tone="amber" />}
            </div>
            <p className="text-sm text-navy/70">
              {activeClient?.name ?? "לקוח"} · {activeCategory?.name ?? "קטגוריה"}
            </p>

            {!showStopConfirm ? (
              <button
                type="button"
                onClick={() => setShowStopConfirm(true)}
                disabled={pending}
                className="w-full rounded-full bg-navy px-6 py-3.5 text-base font-medium text-white disabled:opacity-50 md:w-auto"
              >
                עצירה
              </button>
            ) : (
              <div className="space-y-3 rounded-xl border border-lineDark bg-paper p-4">
                <p className="text-sm font-medium text-navy">אישור עצירה</p>
                <p className="text-sm text-navy/70">
                  משך בפועל: {formatElapsed(elapsed)} · {activeClient?.name} · {activeCategory?.name}
                </p>
                <div>
                  <label className="block text-xs font-medium text-navy/60">הערה / משימה</label>
                  <input
                    value={note ?? ""}
                    onChange={(e) => setNote(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
                  />
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={handleStop}
                    disabled={pending}
                    className="rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-ink disabled:opacity-50"
                  >
                    {pending ? "שומר..." : "שמירה"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowStopConfirm(false)}
                    className="text-sm text-navy/60 hover:text-navy"
                  >
                    ביטול
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-navy/60">לקוח *</label>
                <select
                  value={clientId}
                  onChange={(e) => {
                    setClientId(e.target.value);
                    setCategoryId("");
                  }}
                  className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
                >
                  <option value="">בחירת לקוח</option>
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
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  disabled={!clientId}
                  className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold disabled:opacity-40"
                >
                  <option value="">בחירת קטגוריה</option>
                  {availableCategories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-navy/60">משימה / הערה</label>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="למשל: עדכון דוח שבועי"
                  className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
                />
              </div>
            </div>

            {recent.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium text-navy/60">שילובים אחרונים</p>
                <div className="flex flex-wrap gap-2">
                  {recent.map((r, i) => (
                    <button
                      key={`${r.clientId}-${r.categoryId}-${i}`}
                      type="button"
                      onClick={() => pickRecent(r)}
                      className="rounded-full border border-lineDark bg-white px-3 py-1.5 text-xs text-navy/70 hover:border-gold hover:text-navy"
                    >
                      {r.clientName} · {r.categoryName}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={handleStart}
              disabled={pending || !clientId || !categoryId}
              className="w-full rounded-full bg-gold-gradient px-6 py-3.5 text-base font-medium text-ink disabled:opacity-50 md:w-auto"
            >
              {pending ? "מתחיל..." : "התחלה"}
            </button>
          </div>
        )}

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}
