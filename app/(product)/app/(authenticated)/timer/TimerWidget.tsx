"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import {
  startTimerAction,
  stopTimerAction,
  reopenTimerAction,
  discardActiveTimerAction,
  updateActiveTimerNoteAction,
} from "./actions";
import { useToast } from "@/components/app/toast/ToastProvider";

type Client = { id: string; name: string };
type Category = { id: string; name: string; clientId: string | null };
type Recent = { clientId: string; clientName: string; categoryId: string; categoryName: string; lastUsedAt: string };
export type TodayEntry = { id: string; clientName: string; categoryName: string; actualSeconds: number };
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
// App redesign (handoff README, screen 2): debounce for the running
// timer's "note that saves while working" - long enough not to fire a
// server action on every keystroke, short enough that a closed tab loses
// at most a moment's typing.
const NOTE_AUTOSAVE_DEBOUNCE_MS = 900;

function formatElapsed(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

function formatHM(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.round((totalSeconds % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

function formatLastUsed(iso: string): string {
  const date = new Date(iso);
  const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
  const yesterdayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(
    new Date(Date.now() - 24 * 3600_000)
  );
  const key = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(date);
  const time = new Intl.DateTimeFormat("he-IL", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jerusalem" }).format(
    date
  );
  if (key === todayKey) return `היום ${time}`;
  if (key === yesterdayKey) return `אתמול ${time}`;
  return new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric", timeZone: "Asia/Jerusalem" }).format(date);
}

export function TimerWidget({
  activeTimer,
  clients,
  categories,
  recent,
  todayEntries,
}: {
  activeTimer: ActiveTimer;
  clients: Client[];
  categories: Category[];
  recent: Recent[];
  todayEntries: TodayEntry[];
}) {
  const { showToast } = useToast();
  const [active, setActive] = useState(activeTimer);
  const [clientId, setClientId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  // Shared field: the quick-start note before a timer exists, and the
  // "autosaves while running" note once one does - exactly one of those
  // two contexts is ever visible at a time.
  const [note, setNote] = useState(activeTimer?.note ?? "");
  const [elapsed, setElapsed] = useState(0);
  const [pending, setPending] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!active) return;
    const startMs = new Date(active.startAt).getTime();
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - startMs) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [active]);

  // App redesign (handoff README, screen 2): "שדה הערה שנשמר תוך כדי
  // עבודה" - debounced autosave while a timer is running.
  useEffect(() => {
    if (!active) return;
    if (noteSaveTimer.current) clearTimeout(noteSaveTimer.current);
    noteSaveTimer.current = setTimeout(() => {
      updateActiveTimerNoteAction({ timeEntryId: active.id, note });
    }, NOTE_AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (noteSaveTimer.current) clearTimeout(noteSaveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note, active?.id]);

  const availableCategories = useMemo(
    () => categories.filter((cat) => cat.clientId === null || cat.clientId === clientId),
    [categories, clientId]
  );

  async function beginTimer(targetClientId: string, targetCategoryId: string, startedFromQuickStart: boolean) {
    setPending(true);
    setError(null);
    const result = await startTimerAction({ clientId: targetClientId, categoryId: targetCategoryId, note });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      showToast({ tone: "error", title: "לא ניתן להתחיל טיימר", description: result.error });
      return;
    }
    const client = clients.find((c) => c.id === targetClientId);
    const category = categories.find((c) => c.id === targetCategoryId);
    setActive({
      id: result.entry.id,
      startAt: new Date(result.entry.startAt).toISOString(),
      clientId: result.entry.clientId,
      categoryId: result.entry.categoryId,
      note: result.entry.note,
    });

    // App redesign (handoff README, screen 2, "חשוב"): starting without a
    // note is a *warning* toast, not a success one - but only from the
    // one-click quick-start flow, exactly as the reference prototype's
    // own startTimer()/quick() split it. A deliberate start via the
    // client/category selects always confirms with a plain success toast.
    if (startedFromQuickStart && !note.trim()) {
      showToast({
        tone: "warning",
        title: "הטיימר התחיל בלי הערה",
        description: `${client?.name ?? ""} · ${category?.name ?? ""} — אפשר להוסיף הערה עכשיו או בעצירה.`,
      });
    } else {
      showToast({
        tone: "success",
        title: "הטיימר התחיל",
        description: [client?.name, category?.name, note.trim() || null].filter(Boolean).join(" · "),
      });
    }
  }

  async function handleStart() {
    setError(null);
    if (!clientId || !categoryId) {
      const msg = "יש לבחור לקוח וקטגוריה לפני התחלת הטיימר.";
      setError(msg);
      showToast({ tone: "error", title: "לא ניתן להתחיל טיימר", description: "חסרים לקוח או קטגוריה." });
      return;
    }
    await beginTimer(clientId, categoryId, false);
  }

  async function handleQuickStart(r: Recent) {
    await beginTimer(r.clientId, r.categoryId, true);
  }

  async function handleStop() {
    if (!active) return;
    const stoppedId = active.id;
    const client = clients.find((c) => c.id === active.clientId);
    const category = categories.find((c) => c.id === active.categoryId);
    const durationText = formatElapsed(elapsed);

    setPending(true);
    setError(null);
    const result = await stopTimerAction({ timeEntryId: stoppedId, note });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      showToast({ tone: "error", title: "העצירה נכשלה", description: result.error });
      return;
    }
    setActive(null);
    setElapsed(0);
    setClientId("");
    setCategoryId("");

    // Interactions & Behavior rule 2: "עצירת טיימר" is one of the actions
    // that must carry a *real* undo, not just a client-side rewind -
    // reopenTimerAction actually re-opens the stored entry server-side.
    showToast({
      tone: "success",
      title: `הדיווח נשמר · ${durationText}`,
      description: [client?.name, category?.name].filter(Boolean).join(" · "),
      undo: async () => {
        const reopened = await reopenTimerAction({ timeEntryId: stoppedId });
        if (!reopened.ok) {
          showToast({ tone: "error", title: "שחזור הטיימר נכשל", description: reopened.error });
          return;
        }
        setActive({
          id: reopened.entry.id,
          // reopenTimer() never touches startAt, so this is exactly the
          // original start time the elapsed-time ticker needs to resume
          // counting from where it left off.
          startAt: new Date(reopened.entry.startAt).toISOString(),
          clientId: reopened.entry.clientId,
          categoryId: reopened.entry.categoryId,
          note: reopened.entry.note,
        });
        showToast({ tone: "info", title: "הטיימר שוחזר", description: `ממשיך מ־${durationText}` });
      },
    });
  }

  async function handleDiscard() {
    if (!active) return;
    setDiscarding(true);
    const result = await discardActiveTimerAction({ timeEntryId: active.id });
    setDiscarding(false);
    if (!result.ok) {
      showToast({ tone: "error", title: "המחיקה נכשלה", description: result.error });
      return;
    }
    setActive(null);
    setElapsed(0);
    setNote("");
    showToast({ tone: "warning", title: "הטיימר נמחק ללא שמירה", description: "לא נוצר דיווח זמן." });
  }

  const activeClient = clients.find((c) => c.id === active?.clientId);
  const activeCategory = categories.find((c) => c.id === active?.categoryId);
  const isLongRunning = elapsed > LONG_TIMER_WARNING_SECONDS;
  const todayTotalSeconds = todayEntries.reduce((sum, e) => sum + e.actualSeconds, 0);

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1.35fr_1fr]">
      {/* Hero card - App redesign (handoff README, screen 2): "כרטיס גיבור
          כהה (ink, radius 20px, זוהר רדיאלי זהוב)". */}
      <div className="relative overflow-hidden rounded-[20px] bg-ink p-6 text-paper md:p-8">
        <div className="absolute inset-0 bg-[radial-gradient(60%_60%_at_70%_20%,rgba(176,141,87,0.22)_0%,rgba(176,141,87,0)_70%)]" />
        <div className="relative">
          {active ? (
            <div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 shrink-0 animate-pulse-dot rounded-full bg-gold-light" aria-hidden="true" />
                <span className="text-xs tracking-[.06em] text-cream/60">טיימר פעיל</span>
              </div>
              <p className="mt-3.5 font-jbmono text-[42px] font-medium tracking-tight tabular-nums text-paper sm:text-[58px]">
                {formatElapsed(elapsed)}
              </p>
              <p className="mt-2.5 text-sm text-cream/75">
                {activeClient?.name ?? "לקוח"} · {activeCategory?.name ?? "קטגוריה"}
              </p>
              {isLongRunning && (
                <p className="mt-3.5 inline-flex items-center gap-1.5 rounded-full border border-gold-light/40 bg-gold/22 px-3 py-1.5 text-xs text-cream">
                  הטיימר רץ מעל 8 שעות — כדאי לבדוק
                </p>
              )}
              <label className="mt-5 block">
                <span className="mb-1.5 block text-[11.5px] text-cream/60">הערה — נשמרת תוך כדי עבודה</span>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="על מה עובדים עכשיו?"
                  className="w-full rounded-[10px] border border-gold-light/40 bg-line px-3 py-2.5 text-sm text-paper outline-none placeholder:text-cream/40 focus:border-gold-light"
                />
              </label>
              <div className="mt-4 flex flex-wrap gap-2.5">
                <button
                  type="button"
                  onClick={handleStop}
                  disabled={pending || discarding}
                  className="rounded-full bg-gold-gradient px-6 py-3 text-[14.5px] font-medium text-ink disabled:opacity-50"
                >
                  {pending ? "עוצר..." : "עצירה ושמירה"}
                </button>
                <button
                  type="button"
                  onClick={handleDiscard}
                  disabled={pending || discarding}
                  className="rounded-full border border-paper/16 bg-line px-5 py-3 text-sm text-cream/80 hover:bg-paper/14 disabled:opacity-50"
                >
                  {discarding ? "מוחק..." : "מחיקה ללא שמירה"}
                </button>
              </div>
              <p className="mt-4 text-[11.5px] text-cream/45">העצירה נשמרת מיד. אפשר לבטל מההודעה שתופיע.</p>
            </div>
          ) : (
            <div>
              <span className="text-xs tracking-[.06em] text-cream/60">אין טיימר פעיל</span>
              <p className="mt-3.5 font-jbmono text-[42px] font-medium text-cream/30 sm:text-[58px]">00:00:00</p>
              <p className="mb-5 mt-2.5 text-sm text-cream/70">
                בוחרים לקוח וקטגוריה, או מתחילים משילוב אחרון בלחיצה אחת.
              </p>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
                <label className="block">
                  <span className="mb-1.5 block text-[11.5px] text-cream/60">לקוח</span>
                  <select
                    value={clientId}
                    onChange={(e) => {
                      setClientId(e.target.value);
                      setCategoryId("");
                    }}
                    className="w-full rounded-[10px] border border-paper/18 bg-line px-3 py-2.5 text-sm text-paper outline-none focus:border-gold-light"
                  >
                    <option value="" className="text-navy">
                      בחירת לקוח
                    </option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id} className="text-navy">
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[11.5px] text-cream/60">קטגוריה</span>
                  <select
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    disabled={!clientId}
                    className="w-full rounded-[10px] border border-paper/18 bg-line px-3 py-2.5 text-sm text-paper outline-none focus:border-gold-light disabled:opacity-40"
                  >
                    <option value="" className="text-navy">
                      בחירת קטגוריה
                    </option>
                    {availableCategories.map((cat) => (
                      <option key={cat.id} value={cat.id} className="text-navy">
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="mt-3 block">
                <span className="mb-1.5 block text-[11.5px] text-cream/60">משימה / הערה</span>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="למשל: עדכון דוח שבועי"
                  className="w-full rounded-[10px] border border-paper/18 bg-line px-3 py-2.5 text-sm text-paper outline-none placeholder:text-cream/40 focus:border-gold-light"
                />
              </label>
              {error && (
                <p
                  className="mt-3 flex items-center gap-2 rounded-[10px] px-3 py-2.5 text-[12.5px] text-cream"
                  style={{ background: "rgba(179,38,30,.3)", border: "1px solid rgba(179,38,30,.5)" }}
                >
                  {error}
                </p>
              )}
              <button
                type="button"
                onClick={handleStart}
                disabled={pending || !clientId || !categoryId}
                className="mt-5 rounded-full bg-gold-gradient px-7 py-3 text-[14.5px] font-medium text-ink disabled:opacity-50"
              >
                {pending ? "מתחיל..." : "התחלת טיימר"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Right column */}
      <div className="flex flex-col gap-3.5">
        {!active && recent.length > 0 && (
          <div className="rounded-2xl border border-lineDark bg-white p-[18px]">
            <p className="text-[13px] font-medium text-navy">התחלה מהירה</p>
            <p className="mb-2.5 mt-1 text-[11.5px] text-navy/55">
              הערה קצרה עכשיו חוסכת שחזור בסוף החודש ונכנסת לדוח ללקוח.
            </p>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="על מה עובדים? (מומלץ)"
              className="mb-2.5 w-full rounded-[10px] border border-gold/45 bg-paper px-3 py-2.5 text-[13px] text-navy outline-none focus:border-gold"
            />
            <div className="flex flex-col gap-2">
              {recent.map((r, i) => (
                <button
                  key={`${r.clientId}-${r.categoryId}-${i}`}
                  type="button"
                  onClick={() => handleQuickStart(r)}
                  disabled={pending}
                  className="flex items-center gap-2.5 rounded-xl border border-lineDark bg-paper px-3.5 py-2.5 text-start transition-colors hover:border-gold hover:bg-white disabled:opacity-50"
                >
                  <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-gold/16 text-gold-dim">
                    <ChevronLeft size={13} strokeWidth={2.25} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-navy">
                      {r.clientName} · {r.categoryName}
                    </span>
                    <span className="block text-[11px] text-navy/50">אחרון: {formatLastUsed(r.lastUsedAt)}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* App redesign (handoff README, screen 2): "היום — שלוש שורות עם
            סכום". */}
        <div className="rounded-2xl border border-lineDark bg-white p-[18px]">
          <p className="text-[13px] font-medium text-navy">היום</p>
          <p className="mb-3.5 mt-1 text-[11.5px] text-navy/50">
            {todayEntries.length} דיווחים · סה&quot;כ {formatHM(todayTotalSeconds)}
          </p>
          {todayEntries.length === 0 ? (
            <p className="text-[12.5px] text-navy/45">אין עדיין דיווחים סגורים היום.</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {todayEntries.map((entry) => (
                <div key={entry.id} className="flex items-center gap-2.5 text-[12.5px]">
                  <span className="flex-1 truncate text-navy/75">
                    {entry.clientName} · {entry.categoryName}
                  </span>
                  <span className="font-jbmono text-navy">{formatHM(entry.actualSeconds)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
