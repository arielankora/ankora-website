"use client";
import Link from "next/link";
import { Plus } from "lucide-react";
import { createContext, useActionState, useContext, useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import {
  MAX_SELECTED_MESSAGES,
  MAX_STEP_TITLE,
  MAX_STEPS_FROM_MESSAGES,
  proposeStepText,
  type SelectedMessage,
} from "@/lib/whatsapp-poc/selected-messages";
import { MAX_PORTAL_NOTE_LENGTH } from "@/lib/task-portal-note-text";
import { attachSelectedMessagesAction, listTasksForMessagesAction, type AttachState, type AttachTaskOption } from "./select-actions";

// "סמן הודעות" (4.11.2026), option A of the design Ariel chose on Claude
// Design: a mark mode inside one conversation, a bar with the count, and
// one dialog for both "צרף למשימה קיימת" and "משימה חדשה". Nothing is
// saved until the dialog's button is pressed; see select-actions.ts for
// what is.

type Ctx = {
  on: boolean;
  setOn: (v: boolean) => void;
  selected: Map<string, SelectedMessage>;
  toggle: (m: SelectedMessage) => void;
  clear: () => void;
};

const SelectionContext = createContext<Ctx | null>(null);

function useSelection(): Ctx | null {
  return useContext(SelectionContext);
}

const input = "mt-1 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold";
const label = "block text-xs font-medium text-app-text-secondary";

export function MessageSelectionProvider(props: {
  children: ReactNode;
  chatId: string;
  numberKey: string;
  contactName: string;
  phone: string | null;
  clients: Array<{ id: string; name: string }>;
  defaultClientId: string | null;
  proposedTitle: string;
}) {
  const [on, setOn] = useState(false);
  const [selected, setSelected] = useState<Map<string, SelectedMessage>>(new Map());
  const [dialog, setDialog] = useState<"existing" | "new" | null>(null);

  const ctx = useMemo<Ctx>(
    () => ({
      on,
      setOn: (v) => {
        setOn(v);
        if (!v) setSelected(new Map());
      },
      selected,
      toggle: (m) =>
        setSelected((prev) => {
          const next = new Map(prev);
          if (next.has(m.id)) next.delete(m.id);
          else if (next.size < MAX_SELECTED_MESSAGES) next.set(m.id, m);
          return next;
        }),
      clear: () => setSelected(new Map()),
    }),
    [on, selected],
  );

  // 4.11.2026 (Ariel): Escape leaves the mark mode, like the dialog's own
  // Escape closes the dialog. Only while no dialog is open.
  useEffect(() => {
    if (!on || dialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") ctx.setOn(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [on, dialog, ctx]);

  const list = [...selected.values()];
  const images = list.reduce((n, m) => n + m.files.filter((f) => f.type === "img" || f.type === "image").length, 0);

  return (
    <SelectionContext.Provider value={ctx}>
      {props.children}
      {on ? (
        // Fixed to the bottom of the window: inside the conversation it sat
        // under the reply box and could be scrolled out of sight, leaving no
        // visible way out (Ariel, 4.11.2026).
        <div
          className="fixed inset-x-0 bottom-0 z-40 flex flex-wrap items-center justify-between gap-3 border-t border-app-border bg-navy px-4 py-3 text-white shadow-lg sm:px-6"
          role="region"
          aria-label="הודעות שסומנו"
        >
          <p className="text-sm" aria-live="polite">
            <strong>{list.length === 1 ? "הודעה אחת נבחרה" : `${list.length} הודעות נבחרו`}</strong>
            {images > 0 ? ` · ${images === 1 ? "תמונה אחת" : `${images} תמונות`}` : ""}
            {list.length >= MAX_SELECTED_MESSAGES ? ` · עד ${MAX_SELECTED_MESSAGES} בפעם אחת` : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={list.length === 0}
              onClick={() => setDialog("existing")}
              className="min-h-11 rounded-lg bg-gold px-4 text-sm font-medium text-navy disabled:opacity-50"
            >
              צרף למשימה קיימת
            </button>
            <button
              type="button"
              disabled={list.length === 0}
              onClick={() => setDialog("new")}
              className="min-h-11 rounded-lg border border-white px-4 text-sm text-white disabled:opacity-50"
            >
              משימה חדשה
            </button>
            <button type="button" onClick={ctx.clear} disabled={list.length === 0} className="min-h-11 px-3 text-sm text-white underline disabled:opacity-50">
              ניקוי
            </button>
            <button type="button" onClick={() => ctx.setOn(false)} className="min-h-11 rounded-lg border border-white/60 px-4 text-sm text-white">
              יציאה מסימון
            </button>
          </div>
        </div>
      ) : null}
      {dialog ? (
        <AttachDialog
          mode={dialog}
          setMode={setDialog}
          messages={list}
          {...props}
          onClose={() => setDialog(null)}
          onDone={() => ctx.setOn(false)}
        />
      ) : null}
    </SelectionContext.Provider>
  );
}

/// Renders its children only outside the mark mode: the older "צור משימה
/// מהשיחה" proposes the latest messages, and beside the marked ones it read
/// as if it had kept an earlier selection (Ariel, 4.11.2026).
export function HideWhileSelecting({ children }: { children: ReactNode }) {
  const ctx = useSelection();
  if (ctx?.on) return null;
  return <>{children}</>;
}

/// The header button that turns the mark mode on and off.
export function SelectModeButton() {
  const ctx = useSelection();
  if (!ctx) return null;
  return (
    <button
      type="button"
      aria-pressed={ctx.on}
      onClick={() => ctx.setOn(!ctx.on)}
      className={`flex min-h-11 items-center rounded-lg border px-3 text-sm ${
        ctx.on ? "border-navy bg-navy text-white" : "border-app-border-strong bg-white text-app-text-primary"
      }`}
    >
      {ctx.on ? "סיום סימון" : "סמן הודעות"}
    </button>
  );
}

/// The checkbox beside one message. Renders nothing outside the mark mode.
export function SelectToggle({ message }: { message: SelectedMessage }) {
  const ctx = useSelection();
  if (!ctx?.on) return null;
  const checked = ctx.selected.has(message.id);
  return (
    <label className="flex size-11 flex-none cursor-pointer items-center justify-center self-center">
      <input
        type="checkbox"
        checked={checked}
        onChange={() => ctx.toggle(message)}
        aria-label={message.text ? `סימון ההודעה: ${message.text.slice(0, 40)}` : "סימון ההודעה"}
        className="size-5 accent-navy"
      />
    </label>
  );
}

function AttachDialog(props: {
  mode: "existing" | "new";
  setMode: (m: "existing" | "new") => void;
  messages: SelectedMessage[];
  chatId: string;
  numberKey: string;
  contactName: string;
  phone: string | null;
  clients: Array<{ id: string; name: string }>;
  defaultClientId: string | null;
  proposedTitle: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState<AttachState | undefined, FormData>(attachSelectedMessagesAction, undefined);
  const [clientId, setClientId] = useState(props.defaultClientId ?? (props.clients.length === 1 ? props.clients[0].id : ""));
  const [q, setQ] = useState("");
  const [tasks, setTasks] = useState<AttachTaskOption[] | null>(null);
  const [taskId, setTaskId] = useState("");
  const [newVisible, setNewVisible] = useState(false);
  const [portalOn, setPortalOn] = useState(false);
  const [loading, startLoading] = useTransition();
  // 5.11.2026, option B: the step list. On by default when there is more
  // than one message; one message is usually context, not a checklist.
  const [stepsOn, setStepsOn] = useState(props.messages.length > 1);
  const [keepComment, setKeepComment] = useState(true);
  const [rows, setRows] = useState<StepRow[]>(() => initialRows(props.messages, props.contactName));

  useEffect(() => {
    if (props.mode !== "existing" || !clientId) return;
    const t = setTimeout(() => {
      startLoading(async () => {
        const found = await listTasksForMessagesAction({ clientId, q });
        setTasks(found);
        setTaskId((cur) => (found.some((f) => f.id === cur) ? cur : ""));
      });
    }, 250);
    return () => clearTimeout(t);
  }, [props.mode, clientId, q]);

  useEffect(() => {
    if (state?.done) props.onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per save
  }, [state?.done]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the dialog's own lifetime
  }, []);

  const chosen = tasks?.find((t) => t.id === taskId) ?? null;
  const portalAllowed = props.mode === "new" ? newVisible : Boolean(chosen?.clientVisible);
  const count = props.messages.length;
  const stepLines = stepsOn ? rows.filter((r) => r.on).map((r) => r.text.replace(/\s+/g, " ").trim()).filter(Boolean) : [];
  const tooManySteps = stepLines.length > MAX_STEPS_FROM_MESSAGES;

  if (state?.done) {
    return (
      <Shell title="נשמר" onClose={props.onClose}>
        <p className="text-sm text-app-success" role="status">
          {state.done.created ? "המשימה נוצרה" : "ההודעות צורפו למשימה"}: {state.done.title}.
          {state.done.steps > 0 ? ` ${state.done.steps === 1 ? "נוסף שלב אחד" : `נוספו ${state.done.steps} שלבים`}.` : ""}
          {state.done.images > 0 ? ` ${state.done.images === 1 ? "תמונה אחת תויקה" : `${state.done.images} תמונות תויקו`} במשימה.` : ""}
          {state.done.portalLine ? " השורה ללקוח נוספה לפורטל." : ""}
        </p>
        {state.warnings?.map((w) => (
          <p key={w} className="text-sm text-app-text-primary">
            {w}
          </p>
        ))}
        <div className="flex gap-2">
          <Link href={`/app/tasks/${state.done.taskId}`} className="inline-flex min-h-11 items-center rounded-lg bg-navy px-4 text-sm font-medium text-white">
            לפתיחת המשימה
          </Link>
          <button type="button" onClick={props.onClose} className="min-h-11 rounded-lg border border-app-border-strong bg-white px-4 text-sm text-app-text-primary">
            סגירה
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell title={props.mode === "new" ? `משימה חדשה מ-${count === 1 ? "הודעה אחת" : `${count} הודעות`}` : `צירוף ${count === 1 ? "הודעה אחת" : `${count} הודעות`} למשימה קיימת`} onClose={props.onClose}>
      <form action={action} className="space-y-4">
        <input type="hidden" name="mode" value={props.mode} />
        <input type="hidden" name="messages" value={JSON.stringify(props.messages)} />
        <input type="hidden" name="chatId" value={props.chatId} />
        <input type="hidden" name="numberKey" value={props.numberKey} />
        <input type="hidden" name="contactName" value={props.contactName} />
        <input type="hidden" name="phone" value={props.phone ?? ""} />
        <input type="hidden" name="steps" value={JSON.stringify(stepLines)} />
        {stepLines.length > 0 && keepComment ? <input type="hidden" name="keepComment" value="on" /> : null}

        <div role="group" aria-label="לאן" className="flex gap-2">
          <button
            type="button"
            aria-pressed={props.mode === "existing"}
            onClick={() => props.setMode("existing")}
            className={`min-h-11 flex-1 rounded-lg border px-3 text-sm ${props.mode === "existing" ? "border-navy bg-navy text-white" : "border-app-border-strong bg-white text-app-text-primary"}`}
          >
            משימה קיימת
          </button>
          <button
            type="button"
            aria-pressed={props.mode === "new"}
            onClick={() => props.setMode("new")}
            className={`min-h-11 flex-1 rounded-lg border px-3 text-sm ${props.mode === "new" ? "border-navy bg-navy text-white" : "border-app-border-strong bg-white text-app-text-primary"}`}
          >
            משימה חדשה
          </button>
        </div>

        <div>
          <label htmlFor="sel-client" className={label}>
            לקוח
          </label>
          <select id="sel-client" name="clientId" required value={clientId} onChange={(e) => setClientId(e.target.value)} className={input}>
            <option value="" disabled>
              בחירת לקוח
            </option>
            {props.clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {props.mode === "existing" ? (
          <div className="space-y-2">
            <label htmlFor="sel-q" className={label}>
              חיפוש משימה
            </label>
            <input id="sel-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="למשל: תיאום פגישות" className={input} />
            <fieldset className="max-h-56 space-y-1.5 overflow-y-auto">
              <legend className="sr-only">משימות פתוחות של הלקוח</legend>
              {!clientId ? (
                <p className="text-sm text-app-text-secondary">קודם בוחרים לקוח.</p>
              ) : loading && !tasks ? (
                <p className="text-sm text-app-text-secondary">טוען משימות...</p>
              ) : tasks && tasks.length === 0 ? (
                <p className="text-sm text-app-text-secondary">אין משימות פתוחות שמתאימות. אפשר לעבור ל&quot;משימה חדשה&quot;.</p>
              ) : (
                tasks?.map((t) => (
                  <label
                    key={t.id}
                    className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm ${t.id === taskId ? "border-navy bg-app-accent-soft" : "border-app-border"}`}
                  >
                    <input type="radio" name="taskId" value={t.id} checked={t.id === taskId} onChange={() => setTaskId(t.id)} className="size-5 accent-navy" />
                    <span className="min-w-0 flex-1 truncate">{t.title}</span>
                    {t.clientVisible ? <span className="text-xs text-app-text-secondary">מוצגת ללקוח</span> : null}
                  </label>
                ))
              )}
            </fieldset>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label htmlFor="sel-title" className={label}>
                שם המשימה
              </label>
              <input id="sel-title" name="title" required defaultValue={props.proposedTitle} maxLength={200} className={input} />
            </div>
            <label className="flex min-h-11 items-center gap-2 text-sm text-app-text-primary">
              <input type="checkbox" name="clientVisible" checked={newVisible} onChange={(e) => setNewVisible(e.target.checked)} className="size-5" />
              להציג את המשימה ללקוח בפורטל
            </label>
          </div>
        )}

        <label className="flex min-h-11 items-center gap-2 text-sm text-app-text-primary">
          <input type="checkbox" checked={stepsOn} onChange={(e) => setStepsOn(e.target.checked)} className="size-5 accent-navy" />
          להוסיף את ההודעות כשלבים במשימה
        </label>

        {stepsOn ? (
          <StepsEditor rows={rows} setRows={setRows} count={stepLines.length} existing={props.mode === "existing"} />
        ) : null}

        {stepsOn && stepLines.length > 0 ? (
          <label className="flex items-start gap-2 border-t border-app-border pt-3 text-sm text-app-text-primary">
            <input type="checkbox" checked={keepComment} onChange={(e) => setKeepComment(e.target.checked)} className="mt-0.5 size-5 flex-none accent-navy" />
            <span>
              לשמור גם את ההודעות המלאות כהערה פנימית
              <span className="block text-xs text-app-text-secondary">המקור נשאר במשימה, עם השעות והשולח. תמונות מתויקות במשימה, מוסתרות מהלקוח.</span>
            </span>
          </label>
        ) : (
          <div className="space-y-1 rounded-lg border border-app-border bg-app-surface-page p-3 text-sm">
            <p className="text-xs text-app-text-secondary">ייכנס למשימה כהערה פנימית. תמונות יתויקו כמסמך במשימה, מוסתר מהלקוח.</p>
            <ul className="space-y-0.5">
              {props.messages
                .slice()
                .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
                .map((m) => (
                  <li key={m.id} className="truncate">
                    {m.mine ? "אנחנו" : m.senderName || props.contactName}:{" "}
                    {m.text ||
                      (m.transcript
                        ? `[${m.files[0]?.label || "הודעה קולית"}] ${m.transcript}`
                        : m.files[0]?.label
                          ? `[${m.files[0].label}${m.files[0].type === "audio" ? ", לא תומללה" : ""}]`
                          : "[הודעה שאינה טקסט]")}
                  </li>
                ))}
            </ul>
          </div>
        )}

        <div className="space-y-2">
          <label className={`flex min-h-11 items-center gap-2 text-sm ${portalAllowed ? "text-app-text-primary" : "text-app-text-secondary"}`}>
            <input
              type="checkbox"
              name="portalLineOn"
              checked={portalAllowed && portalOn}
              disabled={!portalAllowed}
              onChange={(e) => setPortalOn(e.target.checked)}
              className="size-5"
            />
            להוסיף שורה לרשימה שהלקוח רואה בפורטל
          </label>
          {!portalAllowed ? (
            <p className="text-xs text-app-text-secondary">אפשרי רק במשימה שמוצגת ללקוח.</p>
          ) : portalOn ? (
            <div>
              <label htmlFor="sel-portal" className={label}>
                השורה שהלקוח יראה (בלי תוכן ההודעות)
              </label>
              <input
                id="sel-portal"
                name="portalLine"
                required
                maxLength={MAX_PORTAL_NOTE_LENGTH}
                placeholder="למשל: רותם כהן · פגישה ברביעי 11.11 ב-11:00"
                className={input}
              />
            </div>
          ) : null}
        </div>

        {state?.error ? (
          <p role="alert" className="text-sm text-app-error">
            {state.error}
          </p>
        ) : null}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={pending || !clientId || (props.mode === "existing" && !taskId) || tooManySteps}
            className="min-h-11 rounded-lg bg-navy px-5 text-sm font-medium text-white disabled:opacity-60"
          >
            {pending ? "שומר..." : submitLabel(props.mode, stepLines.length)}
          </button>
          <button type="button" onClick={props.onClose} className="min-h-11 rounded-lg border border-app-border-strong bg-white px-4 text-sm text-app-text-primary">
            ביטול
          </button>
        </div>
      </form>
    </Shell>
  );
}

function Shell({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[92vh] w-full space-y-4 overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:max-w-xl sm:rounded-2xl"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-medium text-app-text-primary">{title}</h2>
          <button type="button" onClick={onClose} aria-label="סגירה" className="flex size-11 items-center justify-center rounded-lg text-xl text-app-text-secondary">
            ×
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

type StepRow = { key: string; text: string; on: boolean; meta: string; edited: boolean };

const stepTime = new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hour12: false });

/// One row per message, in the order they were written. A message with
/// nothing to read (an image alone) is listed unticked, so it is visible
/// and can still be written in by hand.
function initialRows(messages: SelectedMessage[], contactName: string): StepRow[] {
  return messages
    .slice()
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .map((m) => {
      const text = proposeStepText(m);
      const who = m.mine ? "אנחנו" : m.senderName || contactName || "איש קשר";
      const hasImage = m.files.some((f) => f.type === "img" || f.type === "image");
      const parts = [stepTime.format(new Date(m.at)), who];
      if (!text) parts.push("הודעה בלי טקסט");
      if (hasImage) parts.push("התמונה תתויק במשימה");
      return { key: m.id, text, on: Boolean(text), meta: parts.join(" · "), edited: false };
    });
}

function submitLabel(mode: "existing" | "new", steps: number): string {
  if (mode === "new") return steps === 0 ? "יצירת משימה" : steps === 1 ? "יצירת משימה עם שלב אחד" : `יצירת משימה עם ${steps} שלבים`;
  return steps === 0 ? "צירוף" : steps === 1 ? "צירוף ושלב אחד" : `צירוף ו-${steps} שלבים`;
}

const smallButton =
  "flex size-9 flex-none items-center justify-center rounded-lg text-app-text-secondary hover:bg-app-surface-sunken disabled:opacity-40";

/// The editable step list (option B). Reordering is by buttons rather than
/// drag: it works the same with a finger, a mouse and a keyboard.
function StepsEditor(props: {
  rows: StepRow[];
  setRows: (fn: (prev: StepRow[]) => StepRow[]) => void;
  count: number;
  existing: boolean;
}) {
  const [added, setAdded] = useState(0);
  const update = (key: string, patch: Partial<StepRow>) =>
    props.setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (i: number, by: -1 | 1) =>
    props.setRows((prev) => {
      const j = i + by;
      if (j < 0 || j >= prev.length) return prev;
      const next = prev.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const over = props.count > MAX_STEPS_FROM_MESSAGES;

  return (
    <section aria-label="שלבים במשימה" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-app-text-primary">
          שלבים במשימה <span className="font-normal text-app-text-secondary">· {props.count === 1 ? "שלב אחד" : `${props.count} שלבים`}</span>
        </h3>
        <div className="flex gap-1">
          <button type="button" onClick={() => props.setRows((prev) => prev.map((r) => ({ ...r, on: Boolean(r.text.trim()) })))} className="min-h-9 px-2 text-sm text-app-text-accent underline">
            סימון הכול
          </button>
          <button type="button" onClick={() => props.setRows((prev) => prev.map((r) => ({ ...r, on: false })))} className="min-h-9 px-2 text-sm text-app-text-accent underline">
            ניקוי
          </button>
        </div>
      </div>
      <p className="text-xs text-app-text-secondary">
        כל הודעה היא שורה. אפשר לערוך, להוריד סימון, לשנות סדר או להוסיף שלב. רק השורות המסומנות נשמרות
        {props.existing ? ", אחרי השלבים שכבר במשימה" : ""}.
      </p>
      <ol className="space-y-1.5">
        {props.rows.map((r, i) => (
          <li key={r.key} className={`flex items-start gap-1 rounded-lg p-1 ${r.on ? "" : "bg-app-surface-sunken"}`}>
            <label className="flex size-9 flex-none cursor-pointer items-center justify-center">
              <input
                type="checkbox"
                checked={r.on}
                onChange={(e) => update(r.key, { on: e.target.checked })}
                aria-label={`לכלול את שלב ${i + 1}`}
                className="size-5 accent-navy"
              />
            </label>
            <div className="min-w-0 flex-1 space-y-0.5">
              <textarea
                rows={2}
                value={r.text}
                maxLength={MAX_STEP_TITLE}
                aria-label={`שלב ${i + 1}`}
                placeholder="כתיבת השלב"
                onChange={(e) => update(r.key, { text: e.target.value, edited: true, on: r.on || Boolean(e.target.value.trim()) })}
                className={`w-full resize-none rounded-lg border bg-white px-2.5 py-1.5 text-sm leading-snug text-app-text-primary outline-none focus:border-gold ${r.edited ? "border-gold" : "border-app-border"}`}
              />
              {r.meta || r.edited ? (
                <p className="text-xs text-app-text-tertiary">{[r.meta, r.edited ? "נערך" : ""].filter(Boolean).join(" · ")}</p>
              ) : null}
            </div>
            <div className="flex flex-none flex-col">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`הזזת שלב ${i + 1} למעלה`} className={smallButton}>
                ↑
              </button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === props.rows.length - 1} aria-label={`הזזת שלב ${i + 1} למטה`} className={smallButton}>
                ↓
              </button>
            </div>
            <button
              type="button"
              onClick={() => props.setRows((prev) => prev.filter((x) => x.key !== r.key))}
              aria-label={`הסרת שלב ${i + 1}`}
              className={`${smallButton} text-lg`}
            >
              ×
            </button>
          </li>
        ))}
      </ol>
      <button
        type="button"
        onClick={() => {
          setAdded((n) => n + 1);
          props.setRows((prev) => [...prev, { key: `added-${added}`, text: "", on: true, meta: "", edited: true }]);
        }}
        className="flex min-h-11 items-center gap-1.5 rounded-lg border border-dashed border-app-border-strong bg-white px-3.5 text-sm text-app-text-primary"
      >
        <Plus aria-hidden="true" className="size-4" />
        הוספת שלב
      </button>
      {over ? (
        <p role="alert" className="text-sm text-app-error">
          עד {MAX_STEPS_FROM_MESSAGES} שלבים בפעם אחת. סומנו {props.count}.
        </p>
      ) : null}
    </section>
  );
}
