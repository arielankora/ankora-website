"use client";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, AlertCircle, TriangleAlert, Info, X } from "lucide-react";

// App redesign (design_handoff_ankora_app_redesign/README.md, "Interactions
// & Behavior"): "מערכת הודעות (החלק החשוב ביותר בעיצוב הזה)." Five rules
// this provider exists to make trivial for every screen to follow:
//   1. Every action gets feedback - no silent action.
//   2. Every destructive/bulk action gets a real Undo (see `undo` below):
//      the undo callback should perform the actual reversing action itself
//      (call the same server action the destructive one used, in reverse)
//      and may call showToast() again from inside it to confirm the undo -
//      this provider does not assume what "undone" looks like for a given
//      screen, it just gives the button and the extended auto-dismiss delay.
//   3. Validation errors are shown twice (inline near the field *and* in a
//      toast) - inline is each screen's own responsibility, this provider
//      only covers the toast half.
//   4. Async actions get an in-between state ("שומר…" etc.) - also each
//      screen's own responsibility (usually a `pending` boolean already
//      wired to a Server Action), not this provider's job.
//   5. A real failure stays a failure - never silently swallow an error
//      into a success tone.
//
// Mounted once at app/(product)/layout.tsx per the handoff's own "State
// Management" section, so both the internal app and the client portal/login
// pages under this route group can call useToast().

export type ToastTone = "success" | "error" | "warning" | "info";

/// A question the toast asks, for team adoption's mechanism one.
///
/// The rule the whole mechanism rests on is that the update must not be
/// a step of its own, so it is grafted onto a gesture that already
/// happens: stopping a timer. The toast that already confirms the stop
/// carries the question, and answering it is one tap inside the same
/// surface - no screen, no navigation, nothing to come back to later.
///
/// A choice may ask for one line before it takes effect (`prompt`).
/// That is the definition of done: finishing a promise the client can
/// see needs a sentence saying what came of it, and the moment the clock
/// stops is the moment a person can write it in one line.
///
/// A toast carrying a question does NOT auto-dismiss. A question that
/// disappears while someone is thinking about it is worse than no
/// question: it teaches people the product does not really want an
/// answer.
export type ToastAsk = {
  question: string;
  choices: {
    value: string;
    label: string;
    prompt?: { label: string; placeholder: string };
  }[];
  onAnswer: (value: string, text?: string) => void | Promise<void>;
};

export type ShowToastInput = {
  tone: ToastTone;
  title: string;
  description?: string;
  /** Real undo action. Presence alone extends the auto-dismiss delay to 8s. */
  undo?: () => void | Promise<void>;
  /** A question asked inside the toast. Suppresses auto-dismiss. */
  ask?: ToastAsk;
};

type ToastItem = ShowToastInput & { id: string };

const NORMAL_DURATION_MS = 4500;
const UNDO_DURATION_MS = 8000;

const TONE_CONFIG: Record<
  ToastTone,
  { icon: typeof Check; iconClass: string; iconBg: string; barColor: string }
> = {
  // barColor mirrors the `success`/`error`/`warning`/`neutral` DEFAULT hex
  // values in tailwind.config.ts - kept as literal values here (not a
  // Tailwind border-color class) because the accent bar below is applied
  // via inline style, see the comment on ToastCard's className.
  success: { icon: Check, iconClass: "text-success", iconBg: "bg-success-soft", barColor: "#1F7A4D" },
  error: { icon: AlertCircle, iconClass: "text-error", iconBg: "bg-error-soft", barColor: "#B3261E" },
  warning: { icon: TriangleAlert, iconClass: "text-warning", iconBg: "bg-warning-soft", barColor: "#8A6F45" },
  // No dedicated "info" tone in the handoff's color table - mapped to the
  // neutral token (closest semantic match: "ניטרלי").
  info: { icon: Info, iconClass: "text-neutral", iconBg: "bg-neutral-soft", barColor: "rgba(27,42,61,0.55)" },
};

type ToastContextValue = { showToast: (input: ShowToastInput) => void };

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (input: ShowToastInput) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setToasts((prev) => [...prev, { ...input, id }]);
      if (input.ask) return;
      const duration = input.undo ? UNDO_DURATION_MS : NORMAL_DURATION_MS;
      const timer = setTimeout(() => dismiss(id), duration);
      timers.current.set(id, timer);
    },
    [dismiss]
  );

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        // Stacked bottom-center, per spec. aria-live so screen readers hear
        // new toasts without focus being stolen (rule 1: no silent action).
        className="pointer-events-none fixed inset-x-0 bottom-6 z-[70] flex flex-col items-center gap-2 px-6"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const { icon: Icon, iconClass, iconBg, barColor } = TONE_CONFIG[toast.tone];
  const [undoing, setUndoing] = useState(false);

  async function handleUndo() {
    if (!toast.undo || undoing) return;
    setUndoing(true);
    try {
      await toast.undo();
    } finally {
      onDismiss();
    }
  }

  return (
    <div
      className="animate-toast-in pointer-events-auto w-[min(420px,calc(100vw-48px))] rounded-[14px] border-e border-t border-b border-lineDark bg-white shadow-[0_14px_34px_rgba(11,27,51,0.16)]"
      // Spec's "inset 3px 0 0 <tone>" accent bar, done as a logical
      // border-inline-start (inline style, not a Tailwind class, so it
      // can't collide with border-lineDark above which only targets the
      // other three sides via border-e/border-t/border-b) instead of a raw
      // box-shadow inset, so it lands on the correct side in this app's RTL
      // layout (visually the right edge) rather than always-left the way a
      // literal box-shadow offset would.
      style={{ borderInlineStart: `3px solid ${barColor}` }}
    >
      <div className="flex items-start gap-3 p-4">
        <span className={`flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full ${iconBg}`}>
          <Icon size={14} strokeWidth={2.25} className={iconClass} />
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="text-[13.5px] font-medium text-appNavy">{toast.title}</p>
          {toast.description && <p className="mt-0.5 text-xs text-appNavy/60">{toast.description}</p>}
          {toast.ask && <ToastQuestion ask={toast.ask} onDone={onDismiss} />}
          {toast.undo && !toast.ask && (
            <button
              type="button"
              onClick={handleUndo}
              disabled={undoing}
              className="mt-1.5 text-xs font-medium text-gold-dim hover:text-appNavy disabled:opacity-50"
            >
              {undoing ? "מבטל…" : "ביטול"}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="סגירה"
          className="shrink-0 rounded-full p-1 text-appNavy/30 hover:bg-appNavy/5 hover:text-appNavy/60"
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

/// The question, and the one field a choice may ask for before it counts.
///
/// Two states and no more. Picking a choice with no prompt answers
/// immediately; picking one with a prompt swaps the buttons for a single
/// field, which is still the same toast in the same place rather than a
/// dialog that takes the screen. Going back is always available, because
/// a person who mis-taps on their phone should not have to finish a
/// promise to escape.
function ToastQuestion({ ask, onDone }: { ask: ToastAsk; onDone: () => void }) {
  const [choice, setChoice] = useState<ToastAsk["choices"][number] | null>(null);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  async function answer(value: string, written?: string) {
    if (saving) return;
    setSaving(true);
    try {
      await ask.onAnswer(value, written);
    } finally {
      onDone();
    }
  }

  if (choice?.prompt) {
    return (
      <div className="mt-2">
        <p className="text-xs text-appNavy/60">{choice.prompt.label}</p>
        <div className="mt-1.5 flex items-center gap-1.5">
          <input
            autoFocus
            value={text}
            disabled={saving}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && text.trim()) void answer(choice.value, text.trim());
              if (e.key === "Escape") setChoice(null);
            }}
            placeholder={choice.prompt.placeholder}
            className="min-w-0 flex-1 rounded-[8px] border border-lineDark bg-white px-2.5 py-1.5 text-xs text-appNavy outline-none focus:border-gold"
          />
          <button
            type="button"
            disabled={saving || !text.trim()}
            onClick={() => void answer(choice.value, text.trim())}
            className="shrink-0 rounded-full bg-gold-gradient px-3 py-1.5 text-[11px] font-medium text-navy disabled:opacity-40"
          >
            שמירה
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => setChoice(null)}
            className="shrink-0 text-[11px] text-appNavy/40 hover:text-appNavy"
          >
            חזרה
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2">
      <p className="text-xs text-appNavy/60">{ask.question}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {ask.choices.map((c) => (
          <button
            key={c.value}
            type="button"
            disabled={saving}
            onClick={() => (c.prompt ? setChoice(c) : void answer(c.value))}
            className="rounded-full border border-lineDark bg-white px-2.5 py-1 text-[11px] text-appNavy/75 hover:border-gold disabled:opacity-40"
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}
