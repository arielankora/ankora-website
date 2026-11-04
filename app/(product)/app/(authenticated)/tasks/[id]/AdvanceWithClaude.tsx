"use client";
import { useRef, useState } from "react";
import { Check, Copy, ExternalLink, Sparkles, Timer } from "lucide-react";
import { recordAdvancePromptCopiedAction, startTimerFromAdvanceAction } from "./actions";
import { useActiveTimer } from "@/components/app/ActiveTimerProvider";
import { ADVANCE_TIMER_LABELS, advanceTimerNotice } from "@/lib/advance-timer";

// "קדם עם קלוד" (10.10.2026): one press copies a prompt that carries the
// whole task, and the conversation it starts in Claude ends with a work
// plan saved back on this task through the MCP connection.
//
// The prompt is built on the server when the page renders (see
// lib/app-domain/advance-prompt-input.ts) and arrives here as a string.
// That is what makes the copy reliable: the clipboard write happens
// inside the click itself. A version that fetched the prompt first and
// copied after the await would work in Chrome and fail silently in
// Safari, which only lets a page write to the clipboard during the
// gesture.
//
// When the browser refuses anyway (an insecure origin, a denied
// permission, an old browser), the prompt is shown in a box, already
// selected, with a button that copies it the old way. Nobody is left with
// a button that did nothing.
//
// Where it may be pasted (10.10.2026). The prompt carries the client's name
// and the task's comments, and the privacy policy promises that client data
// reaches AI providers only on a business plan whose terms forbid training
// on it. Ankora's Claude is a Team workspace, which is that plan; a personal
// account is not. The product cannot see which account a person pastes
// into, so it says it, at the one moment it matters.
//
// On a closed task the same place offers "סיכום ולקחים עם קלוד": there is
// nothing left to advance, and the end of a task is the cheapest moment
// to write down what to do differently next time.
//
// "והפעל טיימר" (3.11.2026): a second button that does the same copy and
// also starts a timer on the task from Ankora, so no billable minute is
// lost while Claude loads. The copy comes first, inside the click; the
// timer follows and never undoes it. See lib/advance-timer.ts for when it
// starts and when it leaves the question to Claude.

const CLAUDE_NEW_CHAT = "https://claude.ai/new";

export function AdvanceWithClaude({
  taskId,
  prompt,
  hasPlan,
  mode = "plan",
}: {
  taskId: string;
  prompt: string;
  hasPlan: boolean;
  mode?: "plan" | "lessons";
}) {
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");
  const [timerNotice, setTimerNotice] = useState<string | null>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const { announce } = useActiveTimer();

  // Fire and forget: the measurement must never delay or undo the copy.
  function copied() {
    setState("copied");
    void recordAdvancePromptCopiedAction({ taskId, mode });
  }

  const label = mode === "lessons" ? "סיכום ולקחים עם קלוד" : "קדם עם קלוד";
  const hint =
    mode === "lessons"
      ? "מעתיק פרומט עם נתוני המשימה הסגורה. קלוד כותב איתכם סיכום ולקחים ושומר אותם כהערה פנימית"
      : hasPlan
        ? "מעתיק פרומט עם נתוני המשימה והתוכנית הקיימת, כדי לעדכן אותה או לבצע אותה בקלוד"
        : "מעתיק פרומט עם כל נתוני המשימה. קלוד בונה איתכם תוכנית עבודה ושומר אותה כאן";

  async function startTimer() {
    setTimerNotice("מפעיל טיימר...");
    try {
      const result = await startTimerFromAdvanceAction({ taskId });
      setTimerNotice(advanceTimerNotice(result.outcome, result.error));
      if (result.outcome === "started") announce();
    } catch {
      setTimerNotice(advanceTimerNotice("error"));
    }
  }

  async function copy(withTimer = false) {
    setTimerNotice(null);
    // The copy is awaited first: Safari allows the clipboard only while
    // the click is still the current gesture.
    await copyPrompt();
    if (withTimer) await startTimer();
  }

  async function copyPrompt() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
      await navigator.clipboard.writeText(prompt);
      copied();
    } catch {
      setState("manual");
      // Next frame: the box exists only after this render.
      requestAnimationFrame(() => boxRef.current?.select());
    }
  }

  function copyFromBox() {
    const box = boxRef.current;
    if (!box) return;
    box.select();
    // The legacy path, used only when the modern one already failed.
    const ok = document.execCommand("copy");
    if (ok) copied();
  }

  return (
    <div className="flex flex-col gap-2" data-testid="advance-with-claude">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void copy()}
          title={hint}
          className="inline-flex items-center gap-1.5 rounded-full border border-app-border bg-white px-3 py-1.5 text-[12.5px] font-medium text-app-text-primary transition-colors hover:border-gold"
        >
          {state === "copied" ? <Check size={14} className="text-app-text-accent" /> : <Sparkles size={14} className="text-app-text-accent" />}
          {label}
        </button>
        <button
          type="button"
          onClick={() => void copy(true)}
          title={`${hint}. בנוסף מפעיל טיימר על המשימה כבר עכשיו, כדי שהזמן ייספר מהלחיצה`}
          data-testid="advance-with-claude-timer"
          className="inline-flex items-center gap-1.5 rounded-full border border-app-border bg-white px-3 py-1.5 text-[12.5px] font-medium text-app-text-primary transition-colors hover:border-gold"
        >
          <Timer size={14} className="text-app-text-accent" />
          {ADVANCE_TIMER_LABELS[mode]}
        </button>
        {state === "copied" && (
          <p className="flex flex-wrap items-center gap-x-2 text-[12.5px] text-app-text-secondary" role="status">
            הפרומט הועתק. הדביקו אותו בשיחה חדשה בחשבון הארגוני של אנקורה בקלוד.
            <a
              href={CLAUDE_NEW_CHAT}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-app-text-accent hover:text-app-text-primary"
            >
              פתיחת קלוד
              <ExternalLink size={12} />
            </a>
          </p>
        )}
      </div>
      {timerNotice && (
        <p className="text-[12.5px] text-app-text-secondary" role="status" data-testid="advance-timer-notice">
          {timerNotice}
        </p>
      )}

      {state === "manual" && (
        <div className="rounded-xl border border-app-border bg-cream/40 p-3">
          <p className="text-[12.5px] text-app-text-secondary">הדפדפן לא אפשר העתקה אוטומטית. הטקסט מסומן, אפשר להעתיק אותו מכאן ולהדביק בחשבון הארגוני של אנקורה בקלוד.</p>
          <textarea
            ref={boxRef}
            readOnly
            value={prompt}
            dir="rtl"
            rows={8}
            aria-label="הפרומט לקלוד"
            className="mt-2 w-full resize-y rounded-lg border border-app-border-strong bg-white p-2 font-jbmono text-[11.5px] leading-relaxed text-app-text-primary"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={copyFromBox}
              className="inline-flex items-center gap-1.5 rounded-full border border-app-border bg-white px-3 py-1.5 text-[12.5px] font-medium text-app-text-primary transition-colors hover:border-gold"
            >
              <Copy size={13} />
              העתקה
            </button>
            <button
              type="button"
              onClick={() => setState("idle")}
              className="rounded-full px-3 py-1.5 text-[12.5px] text-app-text-secondary hover:text-app-text-primary"
            >
              סגירה
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
