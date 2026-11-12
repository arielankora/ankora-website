"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Plus } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import {
  startTimerAction,
  stopTimerAction,
  reopenTimerAction,
  moveEntryIntoOpenBankAction,
  discardActiveTimerAction,
  updateActiveTimerNoteAction,
  recordPromiseStageAction,
} from "./actions";
import { useToast } from "@/components/app/toast/ToastProvider";
import { useActiveTimer } from "@/components/app/ActiveTimerProvider";
import { MAX_PARALLEL_TIMERS, parallelSeconds } from "@/lib/app-domain/parallel-timers";
import { formatClockMinutes } from "@/lib/hours-format";

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
  return formatClockMinutes(Math.round(totalSeconds / 60));
}

type Translate = ReturnType<typeof useTranslations<"timer">>;
type Formatter = ReturnType<typeof useFormatter>;

/// Today and yesterday are Israel's days (the day keys stay on the work
/// week's zone); the time itself is shown in the reader's locale and zone.
function formatLastUsed(iso: string, t: Translate, format: Formatter): string {
  const date = new Date(iso);
  const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
  const yesterdayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(
    new Date(Date.now() - 24 * 3600_000)
  );
  const key = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(date);
  const time = format.dateTime(date, { hour: "2-digit", minute: "2-digit" });
  if (key === todayKey) return t("widget.lastUsedToday", { time });
  if (key === yesterdayKey) return t("widget.lastUsedYesterday", { time });
  return format.dateTime(date, { day: "numeric", month: "numeric" });
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
  const { announce } = useActiveTimer();
  const t = useTranslations("timer");
  const format = useFormatter();
  const [actives, setActives] = useState<ActiveTimer[]>(() => [...activeTimers].sort(byStart));
  // 19.10.2026: the server's list wins whenever it changes. A timer
  // stopped in another tab (or by Claude) reaches this screen as a page
  // refresh from ActiveTimerProvider; without this the card would keep
  // counting a timer that no longer exists.
  const serverKey = activeTimers.map((t) => `${t.id}@${t.startAt}`).sort().join(",");
  const [seenServerKey, setSeenServerKey] = useState(serverKey);
  if (seenServerKey !== serverKey) {
    setSeenServerKey(serverKey);
    setActives([...activeTimers].sort(byStart));
  }
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
          title: t("widget.parallelTitle", { names: runningNames }),
          description: t("widget.parallelDescription", {
            names: runningNames,
            client: client?.name ?? t("widget.newClientFallback"),
          }),
          ask: {
            question: t("widget.parallelQuestion"),
            choices: [
              { value: "parallel", label: t("widget.parallelConfirm") },
              { value: "cancel", label: t("widget.cancel") },
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
      showToast({ tone: "error", title: t("widget.startFailed"), description: result.error });
      return;
    }

    setActives((prev) => [...prev.filter((t) => t.id !== result.entry.id), toActive(result.entry)].sort(byStart));
    announce();
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
    const title = confirmParallel ? t("widget.startedParallel") : t("widget.started");
    if (startedFromQuickStart && !note.trim()) {
      showToast({
        tone: "warning",
        title: confirmParallel ? t("widget.startedParallelNoNote") : t("widget.startedNoNote"),
        description: t("widget.startedNoNoteHint", { client: client?.name ?? "", category: category?.name ?? "" }),
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
      const msg = t("widget.pickClientAndCategory");
      setError(msg);
      showToast({ tone: "error", title: t("widget.startFailed"), description: t("widget.missingClientOrCategory") });
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
      startLabel={actives.length > 0 ? t("widget.startParallel") : t("widget.start")}
    />
  );

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1.35fr_1fr]">
      <div className="flex flex-col gap-3.5">
        {actives.length === 0 ? (
          <HeroCard>
            <span className="text-xs tracking-[.06em] text-cream-warm/60">{t("widget.idle")}</span>
            <p className="mt-3.5 font-jbmono text-[42px] font-medium text-cream-warm/30 sm:text-[58px]">00:00:00</p>
            <p className="mb-5 mt-2.5 text-sm text-cream-warm/70">{t("widget.idleHint")}</p>
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
              onStopped={(id) => {
                setActives((prev) => prev.filter((t) => t.id !== id));
                announce();
              }}
              onReopened={(entry) => {
                setActives((prev) => [...prev.filter((t) => t.id !== entry.id), entry].sort(byStart));
                announce();
              }}
            />
          ))
        )}

        {actives.length > 0 && canStartAnother && (
          <div className="rounded-2xl border border-app-border bg-white p-[18px]">
            {addOpen ? (
              <>
                <p className="text-[13px] font-medium text-app-text-primary">{t("widget.addTitle")}</p>
                <p className="mb-3 mt-1 text-[11.5px] text-app-text-secondary">{t("widget.addHint")}</p>
                {startFields("light")}
              </>
            ) : (
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                className="flex items-center gap-2 text-[13px] font-medium text-app-text-primary hover:text-app-text-accent"
              >
                <Plus size={15} strokeWidth={2.25} />
                {t("widget.addButton")}
              </button>
            )}
          </div>
        )}

        {!canStartAnother && (
          <p className="rounded-2xl border border-app-border bg-white px-[18px] py-3.5 text-[12.5px] text-app-text-secondary">
            {t("widget.limitReached", { count: actives.length })}
          </p>
        )}
      </div>

      {/* Right column */}
      <div className="flex flex-col gap-3.5">
        {canStartAnother && recent.length > 0 && (
          <div className="rounded-2xl border border-app-border bg-white p-[18px]">
            <p className="text-[13px] font-medium text-app-text-primary">{t("widget.quickStart")}</p>
            <p className="mb-2.5 mt-1 text-[11.5px] text-app-text-secondary">{t("widget.quickStartHint")}</p>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("widget.quickStartPlaceholder")}
              className="mb-2.5 w-full rounded-[10px] border border-gold/45 bg-app-surface-page px-3 py-2.5 text-[13px] text-app-text-primary outline-none focus:border-gold"
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
                    className="flex items-center gap-2.5 rounded-xl border border-app-border bg-app-surface-page px-3.5 py-2.5 text-start transition-colors hover:border-gold hover:bg-white disabled:opacity-50 disabled:hover:border-app-border disabled:hover:bg-app-surface-page"
                  >
                    <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-gold/16 text-app-text-accent">
                      <ChevronLeft size={13} strokeWidth={2.25} className="ltr:rotate-180" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-app-text-primary">
                        {r.clientName} · {r.categoryName}
                      </span>
                      <span className="block text-[11px] text-app-text-tertiary">
                        {blocked
                          ? t("widget.alreadyRunning")
                          : t("widget.lastUsed", { when: formatLastUsed(r.lastUsedAt, t, format) })}
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
        <div className="rounded-2xl border border-app-border bg-white p-[18px]">
          <p className="text-[13px] font-medium text-app-text-primary">{t("widget.today")}</p>
          <p className="mb-3.5 mt-1 text-[11.5px] text-app-text-tertiary">
            {t("widget.todaySummary", { count: todayEntries.length, total: formatHM(today.totalSeconds) })}
            {today.parallel >= 60 && t("widget.todayParallel", { parallel: formatHM(today.parallel) })}
          </p>
          {todayEntries.length === 0 ? (
            <p className="text-[12.5px] text-app-text-tertiary">{t("widget.todayEmpty")}</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {todayEntries.map((entry) => (
                <div key={entry.id} className="flex items-center gap-2.5 text-[12.5px]">
                  <span dir="auto" className="flex-1 truncate text-app-text-secondary">
                    {entry.clientName} · {entry.categoryName}
                  </span>
                  <span className="font-jbmono text-app-text-primary">{formatHM(entry.actualSeconds)}</span>
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
  const t = useTranslations("timer.card");
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

  // The task the stop will attach, worked out the same way handleStop
  // does, so the field can say up front whether a note is required.
  const clientPromisesForStop = openPromises.filter((p) => p.clientId === timer.clientId);
  const taskAtStop = timer.taskId || (clientPromisesForStop.length === 1 ? clientPromisesForStop[0].id : "");
  const noteRequired = !taskAtStop;
  const noteInputRef = useRef<HTMLInputElement>(null);

  async function handleStop() {
    const durationText = formatElapsed(elapsed);
    if (noteSaveTimer.current) clearTimeout(noteSaveTimer.current);

    // The promise this time was against: whatever was chosen at the
    // start, or - when the timer was started in one click and nothing
    // was chosen - the client's single open promise, if they have
    // exactly one. Guessing between two would be worse than asking.
    const attached = taskAtStop;

    // 7.10.2026: time on no task needs a few words, or the client's
    // activity summary has nothing to say about it. The server refuses
    // too (NoteRequiredError); asking here saves the round trip and
    // keeps the timer running while the note is written.
    if (!attached && !note.trim()) {
      setError(t("noteRequiredError"));
      noteInputRef.current?.focus();
      return;
    }

    setPending(true);
    setError(null);
    const result = await stopTimerAction({ timeEntryId: timer.id, note, taskId: attached || null });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      showToast({ tone: "error", title: t("stopFailed"), description: result.error });
      return;
    }
    onStopped(timer.id);

    // 3.11.2026: the timer was still running when its hour bank closed.
    // The stop stands; the person is asked whether to move it into the
    // open bank. This question comes before the promise question below:
    // it decides which bank the time counts in.
    if (result.closedBank) {
      showToast({
        tone: "warning",
        title: t("saved", { duration: durationText }),
        description: result.closedBank.message,
        ask: {
          question: t("moveQuestion"),
          choices: [
            { value: "move", label: t("move") },
            { value: "keep", label: t("keep") },
          ],
          onAnswer: async (choice) => {
            if (choice !== "move") return;
            const moved = await moveEntryIntoOpenBankAction({ timeEntryId: timer.id });
            if (!moved.ok) {
              showToast({ tone: "error", title: t("moveFailed"), description: moved.error });
              return;
            }
            showToast({ tone: "success", title: t("moved"), description: t("movedHint") });
          },
        },
      });
      return;
    }

    // Team adoption: time against a promise asks where the promise
    // stands now, in the same toast, instead of an undo. The question is
    // the more valuable of the two at this moment.
    const promise = attached ? openPromises.find((p) => p.id === attached) : undefined;
    if (promise) {
      showToast({
        tone: "success",
        title: t("saved", { duration: durationText }),
        description: promise.label,
        ask: {
          question: t("stageQuestion"),
          choices: [
            { value: "IN_PROGRESS", label: t("stageInProgress") },
            { value: "WAITING_ON_CLIENT", label: t("stageWaiting") },
            {
              value: "DONE",
              label: t("stageDone"),
              prompt: { label: t("outcomeLabel"), placeholder: t("outcomePlaceholder") },
            },
          ],
          onAnswer: async (stage, written) => {
            const recorded = await recordPromiseStageAction({
              taskId: promise.id,
              stage: stage as "IN_PROGRESS" | "WAITING_ON_CLIENT" | "DONE",
              clientOutcome: written,
            });
            if (!recorded.ok) {
              showToast({ tone: "error", title: t("stageFailed"), description: recorded.error });
              return;
            }
            showToast({
              tone: "success",
              title: t("clientUpdated"),
              description: written || promise.label,
            });
            // 20.10.2026: "הושלם" closed the task; see TaskRow.
            if (recorded.procedureReminder) {
              showToast({
                tone: "warning",
                title: t("notInFileYet"),
                description: recorded.procedureReminder.text,
                link: { label: t("toReview"), href: recorded.procedureReminder.reviewHref },
              });
            }
          },
        },
      });
      return;
    }

    showToast({
      tone: "success",
      title: t("saved", { duration: durationText }),
      description: [client?.name, category?.name].filter(Boolean).join(" · "),
      undo: async () => {
        const reopened = await reopenTimerAction({ timeEntryId: timer.id });
        if (!reopened.ok) {
          showToast({ tone: "error", title: t("reopenFailed"), description: reopened.error });
          return;
        }
        // reopenTimer() never touches startAt, so this is exactly the
        // original start time the elapsed-time ticker needs to resume
        // counting from where it left off.
        onReopened(toActive(reopened.entry));
        showToast({ tone: "info", title: t("reopened"), description: t("resumesFrom", { duration: durationText }) });
      },
    });
  }

  async function handleDiscard() {
    if (noteSaveTimer.current) clearTimeout(noteSaveTimer.current);
    setDiscarding(true);
    const result = await discardActiveTimerAction({ timeEntryId: timer.id });
    setDiscarding(false);
    if (!result.ok) {
      showToast({ tone: "error", title: t("discardFailed"), description: result.error });
      return;
    }
    onStopped(timer.id);
    showToast({ tone: "warning", title: t("discarded"), description: t("discardedHint") });
  }

  return (
    <HeroCard compact={compact}>
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 shrink-0 animate-pulse-dot rounded-full bg-gold-light" aria-hidden="true" />
        <span className="text-xs tracking-[.06em] text-cream-warm/60">{t("active")}</span>
      </div>
      <p
        className={`font-jbmono font-medium tracking-tight tabular-nums text-cream ${
          compact ? "mt-2.5 text-[36px] sm:text-[44px]" : "mt-3.5 text-[42px] sm:text-[58px]"
        }`}
      >
        {formatElapsed(elapsed)}
      </p>
      <p dir="auto" className="mt-2.5 text-sm text-cream-warm/75">
        {client?.name ?? t("clientFallback")} · {category?.name ?? t("categoryFallback")}
      </p>
      {isLongRunning && (
        <p className="mt-3.5 inline-flex items-center gap-1.5 rounded-full border border-gold-light/40 bg-gold/22 px-3 py-1.5 text-xs text-cream-warm">
          {t("longRunning", { hours: LONG_TIMER_WARNING_SECONDS / 3600 })}
        </p>
      )}
      <label className={`block ${compact ? "mt-4" : "mt-5"}`}>
        <span className="mb-1.5 block text-[11.5px] text-cream-warm/60">
          {noteRequired ? t("noteLabelRequired") : t("noteLabel")}
        </span>
        <input
          ref={noteInputRef}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("notePlaceholder")}
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
          className="rounded-full bg-app-accent px-6 py-3 text-[14.5px] font-medium text-app-text-primary disabled:opacity-50"
        >
          {pending ? t("stopping") : t("stop")}
        </button>
        <button
          type="button"
          onClick={handleDiscard}
          disabled={pending || discarding}
          className="rounded-full border border-cream/16 bg-hairline px-5 py-3 text-sm text-cream-warm/80 hover:bg-cream/14 disabled:opacity-50"
        >
          {discarding ? t("discarding") : t("discard")}
        </button>
      </div>
      {!compact && (
        <p className="mt-4 text-[11.5px] text-cream-warm/45">{t("stopHint")}</p>
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
  const t = useTranslations("timer.fields");
  const dark = tone === "dark";
  const label = dark ? "mb-1.5 block text-[11.5px] text-cream-warm/60" : "mb-1.5 block text-[11.5px] text-app-text-secondary";
  const field = dark
    ? "w-full rounded-[10px] border border-cream/18 bg-hairline px-3 py-2.5 text-sm text-cream outline-none focus:border-gold-light disabled:opacity-40"
    : "w-full rounded-[10px] border border-app-border bg-app-surface-page px-3 py-2.5 text-sm text-app-text-primary outline-none focus:border-gold disabled:opacity-40";
  const input = dark
    ? `${field} placeholder:text-cream-warm/40`
    : `${field} placeholder:text-app-text-tertiary`;

  return (
    <div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
        <label className="block">
          <span className={label}>{t("client")}</span>
          <select value={clientId} onChange={(e) => onClient(e.target.value)} className={field}>
            <option value="" className="text-app-text-primary">
              {t("pickClient")}
            </option>
            {clients.map((c) => (
              <option key={c.id} value={c.id} className="text-app-text-primary">
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={label}>{t("category")}</span>
          {/* aria-label pins the name to the visible label: through the wrapping
              label it also took the shown option, and "קודם בוחרים לקוח"
              made this field answer to "לקוח" as well. */}
          <select
            aria-label={t("category")}
            value={categoryId}
            onChange={(e) => onCategory(e.target.value)}
            disabled={!clientId}
            className={field}
          >
            <option value="" className="text-app-text-primary">
              {clientId ? t("pickCategory") : t("pickClientFirst")}
            </option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id} className="text-app-text-primary">
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
            <span className={label}>{t("promise")}</span>
            <select value={taskId} onChange={(e) => onTask(e.target.value)} className={field}>
              <option value="" className="text-app-text-primary">
                {t("unlinked")}
              </option>
              {promises.map((t) => (
                <option key={t.id} value={t.id} className="text-app-text-primary">
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <label className="mt-3 block">
        <span className={label}>{t("note")}</span>
        <input value={note} onChange={(e) => onNote(e.target.value)} placeholder={t("notePlaceholder")} className={input} />
      </label>
      {error && (
        <p
          className={`mt-3 flex items-center gap-2 rounded-[10px] px-3 py-2.5 text-[12.5px] ${dark ? "text-cream-warm" : "text-app-text-primary"}`}
          style={{ background: dark ? "rgba(179,38,30,.3)" : "rgba(179,38,30,.08)", border: "1px solid rgba(179,38,30,.5)" }}
        >
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={onStart}
        disabled={pending || !clientId || !categoryId}
        className="mt-5 rounded-full bg-app-accent px-7 py-3 text-[14.5px] font-medium text-app-text-primary disabled:opacity-50"
      >
        {pending ? t("starting") : startLabel}
      </button>
    </div>
  );
}
