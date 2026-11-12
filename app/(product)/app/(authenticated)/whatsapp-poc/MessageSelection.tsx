"use client";
import Link from "next/link";
import { Plus } from "lucide-react";
import { createContext, useActionState, useContext, useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
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
  const t = useTranslations("comms.select");
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
          aria-label={t("barAria")}
        >
          <p className="text-sm" aria-live="polite">
            <strong>{t("selected", { count: list.length })}</strong>
            {images > 0 ? ` · ${t("images", { count: images })}` : ""}
            {list.length >= MAX_SELECTED_MESSAGES ? ` · ${t("max", { max: MAX_SELECTED_MESSAGES })}` : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={list.length === 0}
              onClick={() => setDialog("existing")}
              className="min-h-11 rounded-lg bg-gold px-4 text-sm font-medium text-navy disabled:opacity-50"
            >
              {t("attachExisting")}
            </button>
            <button
              type="button"
              disabled={list.length === 0}
              onClick={() => setDialog("new")}
              className="min-h-11 rounded-lg border border-white px-4 text-sm text-white disabled:opacity-50"
            >
              {t("newTask")}
            </button>
            <button type="button" onClick={ctx.clear} disabled={list.length === 0} className="min-h-11 px-3 text-sm text-white underline disabled:opacity-50">
              {t("clear")}
            </button>
            <button type="button" onClick={() => ctx.setOn(false)} className="min-h-11 rounded-lg border border-white/60 px-4 text-sm text-white">
              {t("exit")}
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
  const t = useTranslations("comms.select");
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
      {ctx.on ? t("modeOn") : t("modeOff")}
    </button>
  );
}

/// The checkbox beside one message. Renders nothing outside the mark mode.
export function SelectToggle({ message }: { message: SelectedMessage }) {
  const t = useTranslations("comms.select");
  const ctx = useSelection();
  if (!ctx?.on) return null;
  const checked = ctx.selected.has(message.id);
  return (
    <label className="flex size-11 flex-none cursor-pointer items-center justify-center self-center">
      <input
        type="checkbox"
        checked={checked}
        onChange={() => ctx.toggle(message)}
        aria-label={message.text ? t("toggleWithText", { text: message.text.slice(0, 40) }) : t("toggle")}
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
  const t = useTranslations("comms.select");
  const tf = useTranslations("comms.message.attachment");
  const format = useFormatter();
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
  const [rows, setRows] = useState<StepRow[]>(() => initialRows(props.messages, props.contactName, t, format));

  useEffect(() => {
    if (props.mode !== "existing" || !clientId) return;
    const timer = setTimeout(() => {
      startLoading(async () => {
        const found = await listTasksForMessagesAction({ clientId, q });
        setTasks(found);
        setTaskId((cur) => (found.some((f) => f.id === cur) ? cur : ""));
      });
    }, 250);
    return () => clearTimeout(timer);
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

  const chosen = tasks?.find((task) => task.id === taskId) ?? null;
  const portalAllowed = props.mode === "new" ? newVisible : Boolean(chosen?.clientVisible);
  const count = props.messages.length;
  const stepLines = stepsOn ? rows.filter((r) => r.on).map((r) => r.text.replace(/\s+/g, " ").trim()).filter(Boolean) : [];
  const tooManySteps = stepLines.length > MAX_STEPS_FROM_MESSAGES;

  if (state?.done) {
    return (
      <Shell title={t("savedTitle")} closeLabel={t("close")} onClose={props.onClose}>
        <p className="text-sm text-app-success" role="status">
          {state.done.created ? t("doneCreated", { title: state.done.title }) : t("doneAttached", { title: state.done.title })}
          {state.done.steps > 0 ? ` ${t("doneSteps", { count: state.done.steps })}` : ""}
          {state.done.images > 0 ? ` ${t("doneImages", { count: state.done.images })}` : ""}
          {state.done.portalLine ? ` ${t("donePortal")}` : ""}
        </p>
        {state.warnings?.map((w) => (
          <p key={w} className="text-sm text-app-text-primary">
            {w}
          </p>
        ))}
        <div className="flex gap-2">
          <Link href={`/app/tasks/${state.done.taskId}`} className="inline-flex min-h-11 items-center rounded-lg bg-navy px-4 text-sm font-medium text-white">
            {t("openTask")}
          </Link>
          <button type="button" onClick={props.onClose} className="min-h-11 rounded-lg border border-app-border-strong bg-white px-4 text-sm text-app-text-primary">
            {t("close")}
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell title={props.mode === "new" ? t("titleNew", { count }) : t("titleExisting", { count })} closeLabel={t("close")} onClose={props.onClose}>
      <form action={action} className="space-y-4">
        <input type="hidden" name="mode" value={props.mode} />
        <input type="hidden" name="messages" value={JSON.stringify(props.messages)} />
        <input type="hidden" name="chatId" value={props.chatId} />
        <input type="hidden" name="numberKey" value={props.numberKey} />
        <input type="hidden" name="contactName" value={props.contactName} />
        <input type="hidden" name="phone" value={props.phone ?? ""} />
        <input type="hidden" name="steps" value={JSON.stringify(stepLines)} />
        {stepLines.length > 0 && keepComment ? <input type="hidden" name="keepComment" value="on" /> : null}

        <div role="group" aria-label={t("whereAria")} className="flex gap-2">
          <button
            type="button"
            aria-pressed={props.mode === "existing"}
            onClick={() => props.setMode("existing")}
            className={`min-h-11 flex-1 rounded-lg border px-3 text-sm ${props.mode === "existing" ? "border-navy bg-navy text-white" : "border-app-border-strong bg-white text-app-text-primary"}`}
          >
            {t("existingTask")}
          </button>
          <button
            type="button"
            aria-pressed={props.mode === "new"}
            onClick={() => props.setMode("new")}
            className={`min-h-11 flex-1 rounded-lg border px-3 text-sm ${props.mode === "new" ? "border-navy bg-navy text-white" : "border-app-border-strong bg-white text-app-text-primary"}`}
          >
            {t("newTask")}
          </button>
        </div>

        <div>
          <label htmlFor="sel-client" className={label}>
            {t("client")}
          </label>
          <select id="sel-client" name="clientId" required value={clientId} onChange={(e) => setClientId(e.target.value)} className={input}>
            <option value="" disabled>
              {t("pickClient")}
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
              {t("searchTask")}
            </label>
            <input id="sel-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("searchPlaceholder")} className={input} />
            <fieldset className="max-h-56 space-y-1.5 overflow-y-auto">
              <legend className="sr-only">{t("openTasksLegend")}</legend>
              {!clientId ? (
                <p className="text-sm text-app-text-secondary">{t("clientFirst")}</p>
              ) : loading && !tasks ? (
                <p className="text-sm text-app-text-secondary">{t("loadingTasks")}</p>
              ) : tasks && tasks.length === 0 ? (
                <p className="text-sm text-app-text-secondary">{t("noTasks")}</p>
              ) : (
                tasks?.map((task) => (
                  <label
                    key={task.id}
                    className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm ${task.id === taskId ? "border-navy bg-app-accent-soft" : "border-app-border"}`}
                  >
                    <input type="radio" name="taskId" value={task.id} checked={task.id === taskId} onChange={() => setTaskId(task.id)} className="size-5 accent-navy" />
                    <span dir="auto" className="min-w-0 flex-1 truncate">{task.title}</span>
                    {task.clientVisible ? <span className="text-xs text-app-text-secondary">{t("shownToClient")}</span> : null}
                  </label>
                ))
              )}
            </fieldset>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label htmlFor="sel-title" className={label}>
                {t("taskName")}
              </label>
              <input id="sel-title" name="title" required defaultValue={props.proposedTitle} maxLength={200} dir="auto" className={input} />
            </div>
            <label className="flex min-h-11 items-center gap-2 text-sm text-app-text-primary">
              <input type="checkbox" name="clientVisible" checked={newVisible} onChange={(e) => setNewVisible(e.target.checked)} className="size-5" />
              {t("showInPortal")}
            </label>
          </div>
        )}

        <label className="flex min-h-11 items-center gap-2 text-sm text-app-text-primary">
          <input type="checkbox" checked={stepsOn} onChange={(e) => setStepsOn(e.target.checked)} className="size-5 accent-navy" />
          {t("addAsSteps")}
        </label>

        {stepsOn ? (
          <StepsEditor rows={rows} setRows={setRows} count={stepLines.length} existing={props.mode === "existing"} />
        ) : null}

        {stepsOn && stepLines.length > 0 ? (
          <label className="flex items-start gap-2 border-t border-app-border pt-3 text-sm text-app-text-primary">
            <input type="checkbox" checked={keepComment} onChange={(e) => setKeepComment(e.target.checked)} className="mt-0.5 size-5 flex-none accent-navy" />
            <span>
              {t("keepComment")}
              <span className="block text-xs text-app-text-secondary">{t("keepCommentHint")}</span>
            </span>
          </label>
        ) : (
          <div className="space-y-1 rounded-lg border border-app-border bg-app-surface-page p-3 text-sm">
            <p className="text-xs text-app-text-secondary">{t("commentPreview")}</p>
            <ul className="space-y-0.5">
              {props.messages
                .slice()
                .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
                .map((m) => (
                  <li key={m.id} dir="auto" className="truncate">
                    {m.mine ? t("we") : m.senderName || props.contactName}:{" "}
                    {m.text ||
                      (m.transcript
                        ? `[${m.files[0] ? fileWord(tf, m.files[0]) : tf("voice")}] ${m.transcript}`
                        : m.files[0]
                          ? `[${m.files[0].type === "audio" ? t("notTranscribed", { label: fileWord(tf, m.files[0]) }) : fileWord(tf, m.files[0])}]`
                          : t("nonText"))}
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
            {t("portalLine")}
          </label>
          {!portalAllowed ? (
            <p className="text-xs text-app-text-secondary">{t("portalOnlyVisible")}</p>
          ) : portalOn ? (
            <div>
              <label htmlFor="sel-portal" className={label}>
                {t("portalLineLabel")}
              </label>
              <input
                id="sel-portal"
                name="portalLine"
                required
                maxLength={MAX_PORTAL_NOTE_LENGTH}
                placeholder={t("portalPlaceholder")}
                dir="auto"
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
            {pending ? t("saving") : submitLabel(t, props.mode, stepLines.length)}
          </button>
          <button type="button" onClick={props.onClose} className="min-h-11 rounded-lg border border-app-border-strong bg-white px-4 text-sm text-app-text-primary">
            {t("cancel")}
          </button>
        </div>
      </form>
    </Shell>
  );
}

function Shell({ title, closeLabel, onClose, children }: { title: string; closeLabel: string; onClose: () => void; children: ReactNode }) {
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
          <button type="button" onClick={onClose} aria-label={closeLabel} className="flex size-11 items-center justify-center rounded-lg text-xl text-app-text-secondary">
            ×
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

type StepRow = { key: string; text: string; on: boolean; meta: string; edited: boolean };

type T = ReturnType<typeof useTranslations<"comms.select">>;
type FileT = ReturnType<typeof useTranslations<"comms.message.attachment">>;

/// A file's word on the screen, in the reader's language. The task's comment
/// gets the Hebrew label the file carries (content, ADR 0006).
function fileWord(tf: FileT, f: { type: string }): string {
  if (f.type === "audio") return tf("voice");
  if (f.type === "img" || f.type === "image") return tf("image");
  if (f.type === "video") return tf("video");
  if (f.type === "sticker") return tf("sticker");
  return tf("file");
}

/// One row per message, in the order they were written. A message with
/// nothing to read (an image alone) is listed unticked, so it is visible
/// and can still be written in by hand.
function initialRows(messages: SelectedMessage[], contactName: string, t: T, format: ReturnType<typeof useFormatter>): StepRow[] {
  return messages
    .slice()
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .map((m) => {
      const text = proposeStepText(m);
      const who = m.mine ? t("we") : m.senderName || contactName || t("contactFallback");
      const hasImage = m.files.some((f) => f.type === "img" || f.type === "image");
      const parts = [format.dateTime(new Date(m.at), { hour: "2-digit", minute: "2-digit", hour12: false }), who];
      if (!text) parts.push(t("metaNoText"));
      if (hasImage) parts.push(t("metaImage"));
      return { key: m.id, text, on: Boolean(text), meta: parts.join(" · "), edited: false };
    });
}

function submitLabel(t: T, mode: "existing" | "new", steps: number): string {
  if (mode === "new") return steps === 0 ? t("submit.new") : t("submit.newSteps", { count: steps });
  return steps === 0 ? t("submit.attach") : t("submit.attachSteps", { count: steps });
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
  const t = useTranslations("comms.select.steps");
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
    <section aria-label={t("heading")} className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-app-text-primary">
          {t("heading")} <span className="font-normal text-app-text-secondary">· {t("count", { count: props.count })}</span>
        </h3>
        <div className="flex gap-1">
          <button type="button" onClick={() => props.setRows((prev) => prev.map((r) => ({ ...r, on: Boolean(r.text.trim()) })))} className="min-h-9 px-2 text-sm text-app-text-accent underline">
            {t("selectAll")}
          </button>
          <button type="button" onClick={() => props.setRows((prev) => prev.map((r) => ({ ...r, on: false })))} className="min-h-9 px-2 text-sm text-app-text-accent underline">
            {t("clear")}
          </button>
        </div>
      </div>
      <p className="text-xs text-app-text-secondary">
        {props.existing ? t("hintExisting") : t("hint")}
      </p>
      <ol className="space-y-1.5">
        {props.rows.map((r, i) => (
          <li key={r.key} className={`flex items-start gap-1 rounded-lg p-1 ${r.on ? "" : "bg-app-surface-sunken"}`}>
            <label className="flex size-9 flex-none cursor-pointer items-center justify-center">
              <input
                type="checkbox"
                checked={r.on}
                onChange={(e) => update(r.key, { on: e.target.checked })}
                aria-label={t("include", { n: i + 1 })}
                className="size-5 accent-navy"
              />
            </label>
            <div className="min-w-0 flex-1 space-y-0.5">
              <textarea
                rows={2}
                value={r.text}
                maxLength={MAX_STEP_TITLE}
                aria-label={t("step", { n: i + 1 })}
                placeholder={t("placeholder")}
                dir="auto"
                onChange={(e) => update(r.key, { text: e.target.value, edited: true, on: r.on || Boolean(e.target.value.trim()) })}
                className={`w-full resize-none rounded-lg border bg-white px-2.5 py-1.5 text-sm leading-snug text-app-text-primary outline-none focus:border-gold ${r.edited ? "border-gold" : "border-app-border"}`}
              />
              {r.meta || r.edited ? (
                <p className="text-xs text-app-text-tertiary">{[r.meta, r.edited ? t("edited") : ""].filter(Boolean).join(" · ")}</p>
              ) : null}
            </div>
            <div className="flex flex-none flex-col">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={t("up", { n: i + 1 })} className={smallButton}>
                ↑
              </button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === props.rows.length - 1} aria-label={t("down", { n: i + 1 })} className={smallButton}>
                ↓
              </button>
            </div>
            <button
              type="button"
              onClick={() => props.setRows((prev) => prev.filter((x) => x.key !== r.key))}
              aria-label={t("remove", { n: i + 1 })}
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
        {t("add")}
      </button>
      {over ? (
        <p role="alert" className="text-sm text-app-error">
          {t("over", { max: MAX_STEPS_FROM_MESSAGES, count: props.count })}
        </p>
      ) : null}
    </section>
  );
}
