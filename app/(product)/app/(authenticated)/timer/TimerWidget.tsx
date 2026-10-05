"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Plus } from "lucide-react";
import {
  startTimerAction,
  stopTimerAction,
  reopenTimerAction,
  discardActiveTimerAction,
  updateActiveTimerNoteAction,
  recordPromiseStageAction,
} from "./actions";
import { useToast } from "@/components/app/toast/ToastProvider";
import { MAX_PARALLEL_TIMERS, parallelSeconds } from "@/lib/app-domain/parallel-timers";

type Client = { id: string; name: string };
type Category = { id: string; name: string; clientId: string | null };
type Recent = { clientId: string; clientName: string; categoryId: string; categoryName: string; lastUsedAt: string };
/// An open promise on one of this person's clients. Team adoption's
/// mechanism one needs exactly this much: which client it belongs to, so
/// the picker can narrow to the one being worked on, and what to call it
/// in the toast.
export type OpenPromise = { id: string; clientId: string; label: string };
export type TodayEntry = {
  id: string;
  clientName: string;
  categoryName: string;
  actualSeconds: number;
  /// ISO. Used only to tell how much of today's reported time ran in
  /// parallel (see parallelSeconds).
  startAt: string;
  endAt: string;
};
export type ActiveTimer = {
  id: string;
  startAt: string; // ISO - server Date serialized across the RSC boundary
  clientId: string;
  categoryId: string;
  note: string | null;
  taskId: string | null;
};

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

function toActive(entry: {
  id: string;
  startAt: string | Date;
  clientId: string;
  categoryId: string;
  note: string | null;
  taskId: string | null;
}): ActiveTimer {
  return {
    id: entry.id,
    startAt: new Date(entry.startAt).toISOString(),
    clientId: entry.clientId,
    categoryId: entry.categoryId,
    note: entry.note,
    taskId: entry.taskId,
  };
}

function byStart(a: ActiveTimer, b: ActiveTimer) {
  return new Date(a.startAt).getTime() - new Date(b.startAt).getTime();
}

/// The timer screen.
///
/// Parallel timers (5.10.2026): up to MAX_PARALLEL_TIMERS run at once,
/// never two on one client. Each running timer is its own card with its
/// own clock, note and stop, so stopping one never touches the other.
/// Below the cards, while there is room for another, the start form;
/// starting a second asks first, because each client is then billed the
/// full time and that is a decision, not a side effect.
export function TimerWidget({
  activeTimers,
  clients,
  categories,
  recent,
  todayEntries,
  openPromises,
}: {
  activeTimers: ActiveTimer[];
  clients: Client[];
  categories: Category[];
  recent: Recent[];
  todayEntries: TodayEntry[];
  openPromises: OpenPromise[];
}) {
  const { showToast } = useToast();
  const [actives, setActives] = useState<ActiveTimer[]>(() => [...activeTimers].sort(byStart));
  const [clientId, setClientId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  // The quick-start / start-form note. A running timer's note lives in
  // its own card.
  const [note, setNote] = useState("");
  // Team adoption: which promise this time is against, chosen before the
  // start. Optional - most work is not a promise, and the mechanism is
  // worthless the moment it becomes a field somebody has to clear.
  const [taskId, setTaskId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // With one timer running, the form for a second stays folded until
  // asked for: most of the time one timer is the whole story, and an open
  // form under it reads as an invitation.
  const [addOpen, setAddOpen] = useState(false);

  const runningClientIds = useMemo(() => new Set(actives.map((t) => t.clientId)), [actives]);
  const canStartAnother = actives.length < MAX_PARALLEL_TIMERS;

  // A client that already has a running timer cannot get a second one,
  // so it is not offered.
  const startableClients = useMemo(() => clients.filter((c) => !runningClientIds.has(c.id)), [clients, runningClientIds]);

  const availableCategories = useMemo(
    () => categories.filter((cat) => cat.clientId === null || cat.clientId === clientId),
    [categories, clientId]
  );

  const availablePromises = useMemo(
    () => openPromises.filter((t) => t.clientId === clientId),
    [openPromises, clientId]
  );

  async function beginTimer(
    targetClientId: string,
    targetCategoryId: string,
    startedFromQuickStart: boolean,
    confirmParallel = false
  ) {
    setPending(true);
    setError(null);
    const result = await startTimerAction({
      clientId: targetClientId,
      categoryId: targetCategoryId,
      note,
      // Quick start is one click by definition, and it carries no
      // promise: the picker belongs to the deliberate start. A quick
      // start still gets asked at the stop, which is where the question
      // costs nothing.
      taskId: startedFromQuickStart ? null : taskId || null,
      confirmParallel,
    });
    setPending(false);
    const client = clients.find((c) => c.id === targetClientId);
    const category = categories.find((c) => c.id === targetCategoryId);

    if (!result.ok) {
      // Another timer is running. The server is the one that knows, so
      // the question is asked on its answer, not on what this screen
      // last saw - a timer started from the task screen or from Claude
      // in another tab counts too.
      if ("needsConfirmation" in result && result.needsConfirmation) {
        const runningNames = result.runningClientNames.join(", ");
        showToast({
          tone: "warning",
          title: `רץ טיימר על ${runningNames}`,
          description: `הזמן ייספר במלואו לשני הלקוחות: ${runningNames} ו${client?.name ?? "הלקוח החדש"}.`,
          ask: {
            question: "להפעיל את הטיימר במקביל?",
            choices: [
              { value: "parallel", label: "להפעיל במקביל" },
              { value: "cancel", label: "ביטול" },
            ],
            onAnswer: async (value) => {
              if (value === "parallel") {
                await beginTimer(targetClientId, targetCategoryId, startedFromQuickStart, true);
              }
            },
          },
        });
        return;
      }
      setError(result.error);
      showToast({ tone: "error", title: "לא ניתן להתחיל טיימר", description: result.error });
      return;
    }

    setActives((prev) => [...prev.filter((t) => t.id !== result.entry.id), toActive(result.entry)].sort(byStart));
    setClientId("");
    setCategoryId("");
    setTaskId("");
    setNote("");
    setAddOpen(false);

    // App redesign (handoff README, screen 2, "חשוב"): starting without a
    // note is a *warning* toast, not a success one - but only from the
    // one-click quick-start flow, exactly as the reference prototype's
    // own startTimer()/quick() split it. A deliberate start via the
    // client/category selects always confirms with a plain success toast.
    const title = confirmParallel ? "הטיימר התחיל במקביל" : "הטיימר התחיל";
    if (startedFromQuickStart && !note.trim()) {
      showToast({
        tone: "warning",
        title: confirmParallel ? "הטיימר התחיל במקביל, בלי הערה" : "הטיימר התחיל בלי הערה",
        description: `${client?.name ?? ""} · ${category?.name ?? ""}. אפשר להוסיף הערה עכשיו או בעצירה.`,
      });
    } else {
      showToast({
        tone: "success",
        title,
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

  const today = useMemo(() => {
    const totalSeconds = todayEntries.reduce((sum, e) => sum + e.actualSeconds, 0);
    const { parallelSeconds: parallel } = parallelSeconds(todayEntries);
    return { totalSeconds, parallel };
  }, [todayEntries]);

  const startFields = (tone: "dark" | "light") => (
    <StartFields
      tone={tone}
      clients={startableClients}
      clientId={clientId}
      onClient={(id) => {
        setClientId(id);
        setCategoryId("");
        setTaskId("");
      }}
      categories={availableCategories}
      categoryId={categoryId}
      onCategory={setCategoryId}
      promises={availablePromises}
      taskId={taskId}
      onTask={setTaskId}
      note={note}
      onNote={setNote}
      error={error}
      pending={pending}
      onStart={handleStart}
      startLabel={actives.length > 0 ? "הפעלה במקביל" : "התחלת טיימר"}
    />
  );

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1.35fr_1fr]">
      <div className="flex flex-col gap-3.5">
        {actives.length === 0 ? (
          <HeroCard>
            <span className="text-xs tracking-[.06em] text-cream-warm/60">אין טיימר פעיל</span>
            <p className="mt-3.5 font-jbmono text-[42px] font-medium text-cream-warm/30 sm:text-[58px]">00:00:00</p>
            <p className="mb-5 mt-2.5 text-sm text-cream-warm/70">
              בוחרים לקוח וקטגוריה, או מתחילים משילוב אחרון בלחיצה אחת.
            </p>
            {startFields("dark")}
          </HeroCard>
        ) : (
          actives.map((timer) => (
            <RunningTimerCard
              key={timer.id}
              timer={timer}
              compact={actives.length > 1}
              clients={clients}
              categories={categories}
              openPromises={openPromises}
              onStopped={(id) => setActives((prev) => prev.filter((t) => t.id !== id))}
              onReopened={(entry) =>
                setActives((prev) => [...prev.filter((t) => t.id !== entry.id), entry].sort(byStart))
              }
            />
          ))
        )}

        {actives.length > 0 && canStartAnother && (
          <div className="rounded-2xl border border-lineDark bg-white p-[18px]">
            {addOpen ? (
              <>
                <p className="text-[13px] font-medium text-appNavy">טיימר נוסף, על לקוח אחר</p>
                <p className="mb-3 mt-1 text-[11.5px] text-appNavy/55">
                  שני הטיימרים ירוצו במקביל, וכל לקוח יחויב על הזמן המלא שלו.
                </p>
                {startFields("light")}
              </>
            ) : (
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                className="flex items-center gap-2 text-[13px] font-medium text-appNavy hover:text-gold-dim"
              >
                <Plus size={15} strokeWidth={2.25} />
                הפעלת טיימר נוסף
              </button>
            )}
          </div>
        )}

        {!canStartAnother && (
          <p className="rounded-2xl border border-lineDark bg-white px-[18px] py-3.5 text-[12.5px] text-appNavy/60">
            רצים {actives.length} טיימרים. כדי להתחיל עוד, עוצרים אחד.
          </p>
        )}
      </div>

      {/* Right column */}
      <div className="flex flex-col gap-3.5">
        {canStartAnother && recent.length > 0 && (
          <div className="rounded-2xl border border-lineDark bg-white p-[18px]">
            <p className="text-[13px] font-medium text-appNavy">התחלה מהירה</p>
            <p className="mb-2.5 mt-1 text-[11.5px] text-appNavy/55">
              הערה קצרה עכשיו חוסכת שחזור בסוף החודש ונכנסת לדוח ללקוח.
            </p>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="על מה עובדים? (מומלץ)"
              className="mb-2.5 w-full rounded-[10px] border border-gold/45 bg-cream px-3 py-2.5 text-[13px] text-appNavy outline-none focus:border-gold"
            />
            <div className="flex flex-col gap-2">
              {recent.map((r, i) => {
                // A combination whose client already has a timer running
                // stays in its place, greyed, so the list does not jump
                // around under the person's finger.
                const blocked = runningClientIds.has(r.clientId);
                return (
                  <button
                    key={`${r.clientId}-${r.categoryId}-${i}`}
                    type="button"
                    onClick={() => handleQuickStart(r)}
                    disabled={pending || blocked}
                    className="flex items-center gap-2.5 rounded-xl border border-lineDark bg-cream px-3.5 py-2.5 text-start transition-colors hover:border-gold hover:bg-white disabled:opacity-50 disabled:hover:border-lineDark disabled:hover:bg-cream"
                  >
                    <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-gold/16 text-gold-dim">
                      <ChevronLeft size={13} strokeWidth={2.25} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-appNavy">
                        {r.clientName} · {r.categoryName}
                      </span>
                      <span className="block text-[11px] text-appNavy/50">
                        {blocked ? "כבר רץ טיימר על הלקוח הזה" : `אחרון: ${formatLastUsed(r.lastUsedAt)}`}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* App redesign (handoff README, screen 2): "היום, שלוש שורות עם
            סכום". With parallel timers the sum can exceed the hours on
            the clock, so the part that ran in parallel is said out loud
            rather than left for someone to notice. */}
        <div className="rounded-2xl border border-lineDark bg-white p-[18px]">
          <p className="text-[13px] font-medium text-appNavy">היום</p>
          <p className="mb-3.5 mt-1 text-[11.5px] text-appNavy/50">
            {todayEntries.length} דיווחים · סה&quot;כ {formatHM(today.totalSeconds)}
            {today.parallel >= 60 && <> · מתוכם {formatHM(today.parallel)} במקביל</>}
          </p>
          {todayEntries.length === 0 ? (
            <p className="text-[12.5px] text-appNavy/45">אין עדיין דיווחים סגורים היום.</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {todayEntries.map((entry) => (
                <div key={entry.id} className="flex items-center gap-2.5 text-[12.5px]">
                  <span className="flex-1 truncate text-appNavy/75">
                    {entry.clientName} · {entry.categoryName}
                  </span>
                  <span className="font-jbmono text-appNavy">{formatHM(entry.actualSeconds)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/// App redesign (handoff README, screen 2): "כרטיס גיבור כהה (ink, radius
/// 20px, זוהר רדיאלי זהוב)".
function HeroCard({ children, compact = false }: { children: React.ReactNode; compact?: boolean }) {
  return (
    <div className={`relative overflow-hidden rounded-[20px] bg-navy text-cream ${compact ? "p-5 md:p-6" : "p-6 md:p-8"}`}>
      <div className="absolute inset-0 bg-[radial-gradient(60%_60%_at_70%_20%,rgba(176,141,87,0.22)_0%,rgba(176,141,87,0)_70%)]" />
      <div className="relative">{children}</div>
    </div>
  );
}

/// One running timer: its clock, its note, its stop.
///
/// Everything that used to be the screen's single "active" state lives
/// here per timer, so two of them never share a note, a debounce or a
/// pending flag. The stop flow is unchanged from the one-timer screen:
/// the promise question when the time was against one, otherwise a
/// toast with a real undo.
function RunningTimerCard({
  timer,
  compact,
  clients,
  categories,
  openPromises,
  onStopped,
  onReopened,
}: {
  timer: ActiveTimer;
  compact: boolean;
  clients: Client[];
  categories: Category[];
  openPromises: OpenPromise[];
  onStopped: (id: string) => void;
  onReopened: (timer: ActiveTimer) => void;
}) {
  const { showToast } = useToast();
  const [note, setNote] = useState(timer.note ?? "");
  const [elapsed, setElapsed] = useState(0);
  const [pending, setPending] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstNoteRender = useRef(true);

  useEffect(() => {
    const startMs = new Date(timer.startAt).getTime();
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - startMs) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [timer.startAt]);

  // App redesign (handoff README, screen 2): "שדה הערה שנשמר תוך כדי
  // עבודה" - debounced autosave while a timer is running. Skipped on
  // mount: the note on screen is the one the server just sent.
  useEffect(() => {
    if (firstNoteRender.current) {
      firstNoteRender.current = false;
      return;
    }
    if (noteSaveTimer.current) clearTimeout(noteSaveTimer.current);
    noteSaveTimer.current = setTimeout(() => {
      updateActiveTimerNoteAction({ timeEntryId: timer.id, note });
    }, NOTE_AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (noteSaveTimer.current) clearTimeout(noteSaveTimer.current);
    };
  }, [note, timer.id]);

  const client = clients.find((c) => c.id === timer.clientId);
  const category = categories.find((c) => c.id === timer.categoryId);
  const isLongRunning = elapsed > LONG_TIMER_WARNING_SECONDS;

  async function handleStop() {
    const durationText = formatElapsed(elapsed);
    if (noteSaveTimer.current) clearTimeout(noteSaveTimer.current);

    // The promise this time was against: whatever was chosen at the
    // start, or - when the timer was started in one click and nothing
    // was chosen - the client's single open promise, if they have
    // exactly one. Guessing between two would be worse than asking.
    const clientPromises = openPromises.filter((p) => p.clientId === timer.clientId);
    const attached = timer.taskId || (clientPromises.length === 1 ? clientPromises[0].id : "");

    setPending(true);
    setError(null);
    const result = await stopTimerAction({ timeEntryId: timer.id, note, taskId: attached || null });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      showToast({ tone: "error", title: "העצירה נכשלה", description: result.error });
      return;
    }
    onStopped(timer.id);

    // Team adoption: time against a promise asks where the promise
    // stands now, in the same toast, instead of an undo. The question is
    // the more valuable of the two at this moment.
    const promise = attached ? openPromises.find((p) => p.id === attached) : undefined;
    if (promise) {
      showToast({
        tone: "success",
        title: `הדיווח נשמר · ${durationText}`,
        description: promise.label,
        ask: {
          question: "ומה השלב עכשיו?",
          choices: [
            { value: "IN_PROGRESS", label: "בטיפול" },
            { value: "WAITING_ON_CLIENT", label: "מחכה ללקוח" },
            {
              value: "DONE",
              label: "הושלם",
              prompt: { label: "מה נגיד ללקוח שקרה?", placeholder: "משפט אחד, בשפה שלו" },
            },
          ],
          onAnswer: async (stage, written) => {
            const recorded = await recordPromiseStageAction({
              taskId: promise.id,
              stage: stage as "IN_PROGRESS" | "WAITING_ON_CLIENT" | "DONE",
              clientOutcome: written,
            });
            if (!recorded.ok) {
              showToast({ tone: "error", title: "העדכון נכשל", description: recorded.error });
              return;
            }
            showToast({
              tone: "success",
              title: "הלקוח מעודכן",
              description: written || promise.label,
            });
          },
        },
      });
      return;
    }

    showToast({
      tone: "success",
      title: `הדיווח נשמר · ${durationText}`,
      description: [client?.name, category?.name].filter(Boolean).join(" · "),
      undo: async () => {
        const reopened = await reopenTimerAction({ timeEntryId: timer.id });
        if (!reopened.ok) {
          showToast({ tone: "error", title: "שחזור הטיימר נכשל", description: reopened.error });
          return;
        }
        // reopenTimer() never touches startAt, so this is exactly the
        // original start time the elapsed-time ticker needs to resume
        // counting from where it left off.
        onReopened(toActive(reopened.entry));
        showToast({ tone: "info", title: "הטיימר שוחזר", description: `ממשיך מ־${durationText}` });
      },
    });
  }

  async function handleDiscard() {
    if (noteSaveTimer.current) clearTimeout(noteSaveTimer.current);
    setDiscarding(true);
    const result = await discardActiveTimerAction({ timeEntryId: timer.id });
    setDiscarding(false);
    if (!result.ok) {
      showToast({ tone: "error", title: "המחיקה נכשלה", description: result.error });
      return;
    }
    onStopped(timer.id);
    showToast({ tone: "warning", title: "הטיימר נמחק ללא שמירה", description: "לא נוצר דיווח זמן." });
  }

  return (
    <HeroCard compact={compact}>
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 shrink-0 animate-pulse-dot rounded-full bg-gold-light" aria-hidden="true" />
        <span className="text-xs tracking-[.06em] text-cream-warm/60">טיימר פעיל</span>
      </div>
      <p
        className={`font-jbmono font-medium tracking-tight tabular-nums text-cream ${
          compact ? "mt-2.5 text-[36px] sm:text-[44px]" : "mt-3.5 text-[42px] sm:text-[58px]"
        }`}
      >
        {formatElapsed(elapsed)}
      </p>
      <p className="mt-2.5 text-sm text-cream-warm/75">
        {client?.name ?? "לקוח"} · {category?.name ?? "קטגוריה"}
      </p>
      {isLongRunning && (
        <p className="mt-3.5 inline-flex items-center gap-1.5 rounded-full border border-gold-light/40 bg-gold/22 px-3 py-1.5 text-xs text-cream-warm">
          הטיימר רץ מעל 8 שעות, כדאי לבדוק
        </p>
      )}
      <label className={`block ${compact ? "mt-4" : "mt-5"}`}>
        <span className="mb-1.5 block text-[11.5px] text-cream-warm/60">הערה, נשמרת תוך כדי עבודה</span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="על מה עובדים עכשיו?"
          className="w-full rounded-[10px] border border-gold-light/40 bg-hairline px-3 py-2.5 text-sm text-cream outline-none placeholder:text-cream-warm/40 focus:border-gold-light"
        />
      </label>
      {error && (
        <p
          className="mt-3 flex items-center gap-2 rounded-[10px] px-3 py-2.5 text-[12.5px] text-cream-warm"
          style={{ background: "rgba(179,38,30,.3)", border: "1px solid rgba(179,38,30,.5)" }}
        >
          {error}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2.5">
        <button
          type="button"
          onClick={handleStop}
          disabled={pending || discarding}
          className="rounded-full bg-gold-gradient px-6 py-3 text-[14.5px] font-medium text-navy disabled:opacity-50"
        >
          {pending ? "עוצר..." : "עצירה ושמירה"}
        </button>
        <button
          type="button"
          onClick={handleDiscard}
          disabled={pending || discarding}
          className="rounded-full border border-cream/16 bg-hairline px-5 py-3 text-sm text-cream-warm/80 hover:bg-cream/14 disabled:opacity-50"
        >
          {discarding ? "מוחק..." : "מחיקה ללא שמירה"}
        </button>
      </div>
      {!compact && (
        <p className="mt-4 text-[11.5px] text-cream-warm/45">העצירה נשמרת מיד. אפשר לבטל מההודעה שתופיע.</p>
      )}
    </HeroCard>
  );
}

/// The client / category / promise / note fields and the start button.
/// Rendered in the dark hero when nothing runs, and in a light card under
/// a running timer when a second one is being added.
function StartFields({
  tone,
  clients,
  clientId,
  onClient,
  categories,
  categoryId,
  onCategory,
  promises,
  taskId,
  onTask,
  note,
  onNote,
  error,
  pending,
  onStart,
  startLabel,
}: {
  tone: "dark" | "light";
  clients: Client[];
  clientId: string;
  onClient: (id: string) => void;
  categories: Category[];
  categoryId: string;
  onCategory: (id: string) => void;
  promises: OpenPromise[];
  taskId: string;
  onTask: (id: string) => void;
  note: string;
  onNote: (v: string) => void;
  error: string | null;
  pending: boolean;
  onStart: () => void;
  startLabel: string;
}) {
  const dark = tone === "dark";
  const label = dark ? "mb-1.5 block text-[11.5px] text-cream-warm/60" : "mb-1.5 block text-[11.5px] text-appNavy/60";
  const field = dark
    ? "w-full rounded-[10px] border border-cream/18 bg-hairline px-3 py-2.5 text-sm text-cream outline-none focus:border-gold-light disabled:opacity-40"
    : "w-full rounded-[10px] border border-lineDark bg-cream px-3 py-2.5 text-sm text-appNavy outline-none focus:border-gold disabled:opacity-40";
  const input = dark
    ? `${field} placeholder:text-cream-warm/40`
    : `${field} placeholder:text-appNavy/35`;

  return (
    <div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
        <label className="block">
          <span className={label}>לקוח</span>
          <select value={clientId} onChange={(e) => onClient(e.target.value)} className={field}>
            <option value="" className="text-appNavy">
              בחירת לקוח
            </option>
            {clients.map((c) => (
              <option key={c.id} value={c.id} className="text-appNavy">
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={label}>קטגוריה</span>
          <select value={categoryId} onChange={(e) => onCategory(e.target.value)} disabled={!clientId} className={field}>
            <option value="" className="text-appNavy">
              בחירת קטגוריה
            </option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id} className="text-appNavy">
                {cat.name}
              </option>
            ))}
          </select>
        </label>
        {/* Team adoption: the promise, when this client has any open.
            Third and optional, and absent entirely for a client with
            nothing open - an empty select is a question the screen asks
            and cannot answer. */}
        {clientId && promises.length > 0 && (
          <label className="block">
            <span className={label}>הבטחה ללקוח</span>
            <select value={taskId} onChange={(e) => onTask(e.target.value)} className={field}>
              <option value="" className="text-appNavy">
                לא משויך
              </option>
              {promises.map((t) => (
                <option key={t.id} value={t.id} className="text-appNavy">
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <label className="mt-3 block">
        <span className={label}>משימה / הערה</span>
        <input value={note} onChange={(e) => onNote(e.target.value)} placeholder="למשל: עדכון דוח שבועי" className={input} />
      </label>
      {error && (
        <p
          className={`mt-3 flex items-center gap-2 rounded-[10px] px-3 py-2.5 text-[12.5px] ${dark ? "text-cream-warm" : "text-appNavy"}`}
          style={{ background: dark ? "rgba(179,38,30,.3)" : "rgba(179,38,30,.08)", border: "1px solid rgba(179,38,30,.5)" }}
        >
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={onStart}
        disabled={pending || !clientId || !categoryId}
        className="mt-5 rounded-full bg-gold-gradient px-7 py-3 text-[14.5px] font-medium text-navy disabled:opacity-50"
      >
        {pending ? "מתחיל..." : startLabel}
      </button>
    </div>
  );
}
