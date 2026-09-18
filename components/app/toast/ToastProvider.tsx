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

export type ShowToastInput = {
  tone: ToastTone;
  title: string;
  description?: string;
  /** Real undo action. Presence alone extends the auto-dismiss delay to 8s. */
  undo?: () => void | Promise<void>;
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
          <p className="text-[13.5px] font-medium text-navy">{toast.title}</p>
          {toast.description && <p className="mt-0.5 text-xs text-navy/60">{toast.description}</p>}
          {toast.undo && (
            <button
              type="button"
              onClick={handleUndo}
              disabled={undoing}
              className="mt-1.5 text-xs font-medium text-gold-dim hover:text-navy disabled:opacity-50"
            >
              {undoing ? "מבטל…" : "ביטול"}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="סגירה"
          className="shrink-0 rounded-full p-1 text-navy/30 hover:bg-navy/5 hover:text-navy/60"
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
