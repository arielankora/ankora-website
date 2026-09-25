"use client";
import Link from "next/link";
import { useState } from "react";
import { Check, Eye, EyeOff, Hourglass } from "lucide-react";
import { toggleTaskDoneAction, updateTaskPortalAction } from "./actions";
import { useToast } from "@/components/app/toast/ToastProvider";
import { SUPPLIER_EXPERIENCE_LABELS, waitingTitle } from "@/lib/app-domain/portal-labels";
import type { SupplierExperience, TaskBlocker, TaskPriority, TaskStatus } from "@prisma/client";

// Mirrors lib/app-domain/tasks.ts's TASK_STATUS_LABELS - duplicated
// (rather than imported) because that module starts with `import
// "server-only"`, which a "use client" component can never pull in.
const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  OPEN: "פתוחה",
  IN_PROGRESS: "בביצוע",
  PENDING_APPROVAL: "ממתינה לאישור",
  DONE: "הושלמה",
  ARCHIVED: "בארכיון",
};

const STATUS_TAG_CLASSES: Record<TaskStatus, string> = {
  OPEN: "bg-neutral-soft text-neutral",
  IN_PROGRESS: "bg-warning-soft text-warning",
  // Tasks phase 2. Neither in flight nor finished: the work is done and
  // the task is not. A navy tint rather than a fifth colour token - the
  // portal already uses this exact pair for a held state, and inventing
  // a colour for one status is how a palette stops meaning anything.
  PENDING_APPROVAL: "bg-appNavy/5 text-appNavy/70",
  DONE: "bg-success-soft text-success",
  ARCHIVED: "bg-neutral-soft text-neutral",
};

const STATUS_OPTIONS: TaskStatus[] = ["OPEN", "IN_PROGRESS", "PENDING_APPROVAL", "DONE", "ARCHIVED"];

// Tasks phase 1. A dot and not a pill: NORMAL is most rows and shows
// nothing at all, so the mark only appears where it means something. A
// pill on every row would cost the list its scannability to say "this one
// is ordinary", which is not news.
const PRIORITY_LABELS: Record<TaskPriority, string> = {
  LOW: "נמוכה",
  NORMAL: "רגילה",
  HIGH: "גבוהה",
  URGENT: "דחופה",
};

const PRIORITY_DOTS: Record<TaskPriority, string> = {
  LOW: "bg-appNavy/20",
  NORMAL: "bg-transparent",
  HIGH: "bg-warning",
  URGENT: "bg-error",
};

// App redesign (handoff README, screen 4 "משימות"): "שורה: תיבת סימון
// 20px (ירוקה כשהושלם), כותרת (קו חוצה + עמעום כשהושלם), לקוח · קטגוריה,
// תג סטטוס, תאריך יעד. סימון כהושלם -> טוסט עם ביטול." The checkbox is a
// dedicated one-click complete/reopen gesture (matching the spec
// exactly); the status tag next to it is kept as a real (if compact)
// select so IN_PROGRESS/ARCHIVED - which the checkbox alone can't reach -
// stay reachable, both wired through the same toggleTaskDoneAction so
// either control produces the same toast+undo behavior.
export function TaskRow({
  task,
}: {
  task: {
    id: string;
    title: string;
    clientName: string;
    categoryName: string | null;
    dueDate: string | null;
    status: TaskStatus;
    priority: TaskPriority;
    // Portal phase 1.
    clientVisible: boolean;
    clientTitle: string | null;
    /// Tasks phase 5. Null means nothing is holding this up.
    blockedOn: TaskBlocker | null;
    blockedSince: string | null;
    stepsTotal: number;
    stepsDone: number;
    // Portal phase 3.
    supplierName: string | null;
    supplierExperience: SupplierExperience | null;
    // Team adoption: what came of it, in the client's language.
    clientOutcome: string | null;
  };
}) {
  const { showToast } = useToast();
  const [status, setStatus] = useState(task.status);
  const [pending, setPending] = useState(false);
  const isDone = status === "DONE";

  // Portal phase 1: the three fields that decide whether this task is a
  // promise the client can see, and what it says to them. Kept in the
  // row rather than behind a detail screen because the moment a person
  // knows a task is client-facing is the moment they are looking at it
  // in this list.
  const [clientVisible, setClientVisible] = useState(task.clientVisible);
  const [blockedOn, setBlockedOn] = useState(task.blockedOn);
  const [blockedSince, setBlockedSince] = useState(task.blockedSince);
  const [clientTitle, setClientTitle] = useState(task.clientTitle ?? "");
  const [editingTitle, setEditingTitle] = useState(false);
  const [portalPending, setPortalPending] = useState(false);

  // Portal phase 3: who actually did it. Offered at the moment the task
  // closes, which is the only moment the answer is both known and cheap -
  // the 22.9 decision was one field here rather than a supplier screen,
  // precisely so that nobody has to go somewhere else to record it.
  const [supplierName, setSupplierName] = useState(task.supplierName ?? "");
  const [supplierExperience, setSupplierExperience] = useState<SupplierExperience | null>(task.supplierExperience);
  const [editingSupplier, setEditingSupplier] = useState(false);

  // Team adoption: the definition of done.
  //
  // `closing` is the row asking the one question that closing a visible
  // promise now requires. The server refuses the close without an answer
  // (updateTask's assertClosable), so the alternative would be to send
  // the close, get it rejected, and show the person an error for
  // something they were never asked. The question comes first instead,
  // at the moment they already decided the thing is finished.
  const [clientOutcome, setClientOutcome] = useState(task.clientOutcome ?? "");
  const [closing, setClosing] = useState(false);
  const [editingOutcome, setEditingOutcome] = useState(false);

  async function writePortal(
    patch: {
      clientVisible?: boolean;
      clientTitle?: string | null;
      waitingOnClient?: boolean;
      supplierName?: string | null;
      supplierExperience?: SupplierExperience | null;
      clientOutcome?: string | null;
    },
    toast: { title: string; description?: string; undo?: () => void }
  ) {
    setPortalPending(true);
    const result = await updateTaskPortalAction({ taskId: task.id, ...patch });
    setPortalPending(false);
    if (!result.ok) {
      // Roll the optimistic state back to what the server still holds.
      setClientVisible(task.clientVisible);
      setBlockedOn(task.blockedOn);
      setBlockedSince(task.blockedSince);
      setClientTitle(task.clientTitle ?? "");
      setSupplierName(task.supplierName ?? "");
      setSupplierExperience(task.supplierExperience);
      setClientOutcome(task.clientOutcome ?? "");
      showToast({ tone: "error", title: "העדכון נכשל", description: result.error });
      return;
    }
    setClientVisible(result.clientVisible);
    setBlockedOn(result.blockedOn);
    setBlockedSince(result.blockedSince);
    setClientTitle(result.clientTitle ?? "");
    setSupplierName(result.supplierName ?? "");
    setSupplierExperience(result.supplierExperience);
    setClientOutcome(result.clientOutcome ?? "");
    showToast({ tone: "success", ...toast });
  }

  async function toggleVisible() {
    const next = !clientVisible;
    setClientVisible(next);
    // Hiding a task also stops it waiting: a client cannot answer
    // something they can no longer see, and leaving the flag set would
    // make it reappear as "מחכה לך" the moment it is shown again.
    if (!next) {
      setBlockedOn(null);
      setBlockedSince(null);
    }
    await writePortal(
      { clientVisible: next, ...(next ? {} : { waitingOnClient: false }) },
      {
        title: next ? "המשימה מוצגת ללקוח" : "המשימה הוסרה מהפורטל",
        description: clientTitle || task.title,
        undo: () => toggleVisible(),
      }
    );
  }

  /// One click, and it means the client.
  ///
  /// Tasks phase 5 gave the field four blockers and a reason, and this
  /// gesture deliberately stayed one click: the task screen is where
  /// somebody says "ממתין לספק, ההצעה אצלם מיום ראשון". Pressing it
  /// while the task waits on anything at all clears it, because the
  /// button asks one question and it is "are we still waiting".
  async function toggleWaiting() {
    const next = blockedOn === null;
    setBlockedOn(next ? "CLIENT" : null);
    setBlockedSince(next ? new Date().toISOString() : null);
    await writePortal(
      { waitingOnClient: next },
      {
        title: next ? "סומן כמחכה ללקוח" : "המשימה חזרה לטיפול",
        description: clientTitle || task.title,
        undo: () => toggleWaiting(),
      }
    );
  }

  async function saveTitle() {
    setEditingTitle(false);
    if ((task.clientTitle ?? "") === clientTitle.trim()) return;
    await writePortal(
      { clientTitle: clientTitle.trim() || null },
      { title: clientTitle.trim() ? "הכותרת ללקוח עודכנה" : "הכותרת ללקוח הוסרה", description: task.title }
    );
  }

  async function saveSupplier(experience: SupplierExperience) {
    const name = supplierName.trim();
    setEditingSupplier(false);
    if (!name) return;
    setSupplierExperience(experience);
    await writePortal(
      { supplierName: name, supplierExperience: experience },
      { title: "נרשם בתיק הלקוח", description: `${name} · ${SUPPLIER_EXPERIENCE_LABELS[experience]}` }
    );
  }

  async function clearSupplier() {
    setEditingSupplier(false);
    setSupplierName("");
    setSupplierExperience(null);
    await writePortal({ supplierName: null }, { title: "הספק הוסר מהתיק", description: task.title });
  }

  /// Save the outcome sentence and close in the same call.
  ///
  /// One call rather than "write the sentence, then close": two writes
  /// mean a window where the promise carries a result and is still open,
  /// and a person who closes the tab in that window leaves it there.
  async function confirmClose() {
    const outcome = clientOutcome.trim();
    if (!outcome) return;
    setClosing(false);
    await changeStatus("DONE", false, outcome);
  }

  function cancelClose() {
    setClosing(false);
    setClientOutcome(task.clientOutcome ?? "");
  }

  async function saveOutcome() {
    setEditingOutcome(false);
    if ((task.clientOutcome ?? "") === clientOutcome.trim()) return;
    // Emptying it is refused on a closed visible promise, the same rule
    // as closing without one - so the row asks nothing and simply does
    // not offer that: an empty value here is a no-op rather than a write
    // the server would reject.
    if (!clientOutcome.trim() && isDone) {
      setClientOutcome(task.clientOutcome ?? "");
      return;
    }
    await writePortal(
      { clientOutcome: clientOutcome.trim() || null },
      { title: "שורת התוצאה עודכנה", description: clientOutcome.trim() || task.title }
    );
  }

  async function changeStatus(nextStatus: TaskStatus, isUndo = false, outcome?: string) {
    const previousStatus = status;
    if (nextStatus === previousStatus) return;

    // The one interception: finishing something the client can see, with
    // nothing yet written about what came of it. Ask here rather than
    // let the server refuse a gesture the person had no way to complete.
    if (nextStatus === "DONE" && clientVisible && outcome === undefined && !clientOutcome.trim()) {
      setClosing(true);
      return;
    }

    setStatus(nextStatus);
    setPending(true);
    const result = await toggleTaskDoneAction({ taskId: task.id, nextStatus, clientOutcome: outcome });
    setPending(false);
    if (!result.ok) {
      setStatus(previousStatus);
      showToast({ tone: "error", title: "העדכון נכשל", description: result.error });
      return;
    }
    if (isUndo) {
      showToast({ tone: "info", title: "הסימון בוטל", description: task.title });
      return;
    }
    if (outcome !== undefined) setClientOutcome(result.clientOutcome ?? outcome);
    if (nextStatus === "DONE") {
      showToast({
        tone: "success",
        title: "המשימה סומנה כהושלמה",
        // The sentence the client will read, shown back at the moment it
        // is saved. This is the only place it is confirmed, and a person
        // who sees their own wording here catches a bad one immediately.
        description: outcome || task.title,
        undo: () => changeStatus(previousStatus, true),
      });
    } else {
      showToast({
        tone: "info",
        title: `הסטטוס עודכן ל${TASK_STATUS_LABELS[nextStatus]}`,
        description: task.title,
        undo: () => changeStatus(previousStatus, true),
      });
    }
  }

  return (
    // `data-task` is the row's own handle, for the browser suite. The
    // alternative is a locator built out of layout classes, which
    // silently stops matching the day someone changes the padding - and
    // a test that quietly matches nothing is worse than no test.
    <div data-task={task.id} className="flex items-center gap-3.5 px-[18px] py-3.5">
      <button
        type="button"
        role="checkbox"
        aria-checked={isDone}
        aria-label={isDone ? "סימון כפתוחה" : "סימון כהושלמה"}
        disabled={pending}
        onClick={() => changeStatus(isDone ? "OPEN" : "DONE")}
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border transition-colors disabled:opacity-50 ${
          isDone ? "border-success bg-success" : "border-lineDark bg-white hover:border-gold"
        }`}
      >
        {isDone && <Check size={13} strokeWidth={3} className="text-white" />}
      </button>

      <div className="min-w-0 flex-1">
        {/* Tasks phase 1: the title is the way in to the task's own
            screen. A row is where work is ticked off; everything else
            about a task - its description, its hours, who changed what -
            lives one click away and had nowhere to be until now. */}
        <div className="flex items-center gap-1.5">
          {task.priority !== "NORMAL" && (
            <span
              title={`עדיפות ${PRIORITY_LABELS[task.priority]}`}
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${PRIORITY_DOTS[task.priority]}`}
            />
          )}
          <Link
            href={`/app/tasks/${task.id}`}
            // Same decision as the nav, for the same reason, and this
            // time with the run that proves it.
            //
            // A task screen is dynamic, signed-in and database-backed, so
            // there is nothing here for Next to prefetch but a loading
            // shell - at the cost of one session check and one render per
            // ROW, fired the moment the list paints.
            //
            // The browser suite caught the consequence on the run that
            // added these links: a task created from the drawer took a
            // reload to appear, and the traffic beside the failure was a
            // burst of `/app/tasks/<id>?_rsc=` prefetches, all aborted,
            // sharing a single-worker runner with the refresh that was
            // supposed to bring the row in. The nav's own comment had
            // already recorded this pattern; these links reintroduced it
            // one per row.
            prefetch={false}
            className={`truncate text-[13.5px] hover:underline ${isDone ? "text-appNavy/40 line-through" : "text-appNavy"}`}
          >
            {task.title}
          </Link>
        </div>
        <p className="mt-0.5 truncate text-[11.5px] text-appNavy/50">
          {task.clientName}
          {task.categoryName ? ` · ${task.categoryName}` : ""}
          {/* Tasks phase 5: how far into its steps this task is.
              Beside the client and the category rather than as its own
              badge, because it is a fact about the task and not a state
              of it. Hidden entirely at zero: most tasks here have no
              steps, and "0/0" on every row is noise that teaches people
              to stop reading this line. */}
          {task.stepsTotal > 0 && (
            <span className="font-jbmono"> · {task.stepsDone}/{task.stepsTotal}</span>
          )}
        </p>

        {clientVisible &&
          (editingTitle ? (
            <input
              autoFocus
              value={clientTitle}
              disabled={portalPending}
              onChange={(e) => setClientTitle(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  setClientTitle(task.clientTitle ?? "");
                  setEditingTitle(false);
                }
              }}
              placeholder="איך זה ייקרא אצל הלקוח"
              className="mt-1.5 w-full rounded-[8px] border border-lineDark bg-white px-2.5 py-1.5 text-[12px] text-appNavy outline-none focus:border-gold"
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditingTitle(true)}
              className="mt-1 truncate text-[11.5px] text-gold-dim hover:underline"
            >
              {clientTitle || "הוספת כותרת ללקוח"}
            </button>
          ))}

        {/* Team adoption: the definition of done.

            Opened by the checkbox when a visible promise is being closed
            with nothing written about it, and shown from then on so the
            sentence stays editable - a result the client reads should be
            fixable without reopening the work. */}
        {clientVisible && (closing || isDone || clientOutcome) && (
          <div className="mt-1.5">
            {closing ? (
              <div className="rounded-[10px] border border-gold/40 bg-[#FBF7F0] p-2.5">
                <p className="text-[11.5px] text-appNavy/70">מה נגיד ללקוח שקרה?</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <input
                    autoFocus
                    value={clientOutcome}
                    disabled={pending}
                    onChange={(e) => setClientOutcome(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void confirmClose();
                      if (e.key === "Escape") cancelClose();
                    }}
                    placeholder="משפט אחד, בשפה שלו"
                    className="min-w-0 flex-1 rounded-[8px] border border-lineDark bg-white px-2.5 py-1.5 text-[12px] text-appNavy outline-none focus:border-gold"
                  />
                  <button
                    type="button"
                    disabled={pending || !clientOutcome.trim()}
                    onClick={() => void confirmClose()}
                    className="rounded-full bg-gold-gradient px-3 py-1.5 text-[11px] font-medium text-navy disabled:opacity-40"
                  >
                    סיום
                  </button>
                  <button type="button" onClick={cancelClose} className="text-[11px] text-appNavy/40 hover:text-appNavy">
                    ביטול
                  </button>
                </div>
              </div>
            ) : editingOutcome ? (
              <input
                autoFocus
                value={clientOutcome}
                disabled={portalPending}
                onChange={(e) => setClientOutcome(e.target.value)}
                onBlur={saveOutcome}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") {
                    setClientOutcome(task.clientOutcome ?? "");
                    setEditingOutcome(false);
                  }
                }}
                placeholder="מה קרה בפועל, בשפה של הלקוח"
                className="w-full rounded-[8px] border border-lineDark bg-white px-2.5 py-1.5 text-[12px] text-appNavy outline-none focus:border-gold"
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditingOutcome(true)}
                className="truncate text-[11.5px] text-appNavy/60 hover:underline"
              >
                {clientOutcome || "הוספת שורת תוצאה"}
              </button>
            )}
          </div>
        )}

        {/* Portal phase 3. Only once the task is both shown to the client
            and closed: before that the answer is not known, and for a
            task the client never sees there is nobody to show it to. */}
        {clientVisible && (isDone || supplierName) && (
          <div className="mt-1.5">
            {editingSupplier ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <input
                  autoFocus
                  value={supplierName}
                  disabled={portalPending}
                  onChange={(e) => setSupplierName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setSupplierName(task.supplierName ?? "");
                      setEditingSupplier(false);
                    }
                  }}
                  placeholder="מי ביצע בפועל"
                  className="w-40 rounded-[8px] border border-lineDark bg-white px-2.5 py-1.5 text-[12px] text-appNavy outline-none focus:border-gold"
                />
                {(Object.keys(SUPPLIER_EXPERIENCE_LABELS) as SupplierExperience[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    disabled={portalPending || !supplierName.trim()}
                    onClick={() => saveSupplier(key)}
                    className="rounded-full border border-lineDark bg-white px-2.5 py-1 text-[11px] text-appNavy/70 hover:border-gold disabled:opacity-40"
                  >
                    {SUPPLIER_EXPERIENCE_LABELS[key]}
                  </button>
                ))}
                {task.supplierName && (
                  <button
                    type="button"
                    disabled={portalPending}
                    onClick={clearSupplier}
                    className="text-[11px] text-appNavy/40 hover:text-error"
                  >
                    הסרה
                  </button>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setEditingSupplier(true)}
                className="truncate text-[11.5px] text-gold-dim hover:underline"
              >
                {supplierName
                  ? `${supplierName}${supplierExperience ? ` · ${SUPPLIER_EXPERIENCE_LABELS[supplierExperience]}` : ""}`
                  : "מי ביצע בפועל?"}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Portal phase 1. Two icons, not a panel: the row already carries
          five controls, and these are both binary. The hourglass only
          appears once the task is visible, because "waiting on the
          client" is meaningless for something the client cannot see. */}
      <button
        type="button"
        aria-pressed={clientVisible}
        aria-label={clientVisible ? "הסרה מהפורטל" : "הצגה ללקוח בפורטל"}
        title={clientVisible ? "מוצג ללקוח" : "לא מוצג ללקוח"}
        disabled={portalPending}
        onClick={toggleVisible}
        className={`shrink-0 rounded-full border p-1.5 transition-colors disabled:opacity-50 ${
          clientVisible ? "border-gold/50 bg-gold/12 text-appNavy" : "border-lineDark bg-white text-appNavy/35 hover:border-gold"
        }`}
      >
        {clientVisible ? <Eye size={15} strokeWidth={1.6} /> : <EyeOff size={15} strokeWidth={1.6} />}
      </button>

      {/* Also when the task is internal and blocked: a task waiting on
          a supplier is not a portal concept, and the person looking at
          this row still needs to see it and to be able to clear it. */}
      {(clientVisible || blockedOn !== null) && (
        <button
          type="button"
          aria-pressed={blockedOn !== null}
          aria-label={blockedOn ? "כבר לא ממתינים" : "סימון כמחכה ללקוח"}
          title={blockedOn ? waitingTitle(blockedOn, blockedSince) : "לא ממתין לאף אחד"}
          disabled={portalPending}
          onClick={toggleWaiting}
          className={`shrink-0 rounded-full border p-1.5 transition-colors disabled:opacity-50 ${
            blockedOn !== null
              ? "border-warning/50 bg-warning-soft text-warning"
              : "border-lineDark bg-white text-appNavy/35 hover:border-gold"
          }`}
        >
          <Hourglass size={15} strokeWidth={1.6} />
        </button>
      )}

      <select
        value={status}
        disabled={pending}
        onChange={(e) => changeStatus(e.target.value as TaskStatus)}
        className={`shrink-0 rounded-full border-0 px-2.5 py-1 text-xs font-medium outline-none disabled:opacity-50 ${STATUS_TAG_CLASSES[status]}`}
      >
        {STATUS_OPTIONS.map((opt) => (
          <option key={opt} value={opt} className="bg-white text-appNavy">
            {TASK_STATUS_LABELS[opt]}
          </option>
        ))}
      </select>

      <span className="w-[72px] shrink-0 text-end text-xs text-appNavy/50">
        {task.dueDate
          ? new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric", timeZone: "Asia/Jerusalem" }).format(
              new Date(task.dueDate)
            )
          : "-"}
      </span>
    </div>
  );
}
