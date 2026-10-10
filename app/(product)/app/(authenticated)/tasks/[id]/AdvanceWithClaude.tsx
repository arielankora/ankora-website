"use client";
import { useRef, useState } from "react";
import { Check, Copy, ExternalLink, Sparkles } from "lucide-react";
import { recordAdvancePromptCopiedAction } from "./actions";

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
// On a closed task the same place offers "סיכום ולקחים עם קלוד": there is
// nothing left to advance, and the end of a task is the cheapest moment
// to write down what to do differently next time.

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
  const boxRef = useRef<HTMLTextAreaElement>(null);

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

  async function copy() {
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
          onClick={copy}
          title={hint}
          className="inline-flex items-center gap-1.5 rounded-full border border-lineDark bg-white px-3 py-1.5 text-[12.5px] font-medium text-appNavy transition-colors hover:border-gold"
        >
          {state === "copied" ? <Check size={14} className="text-gold-dim" /> : <Sparkles size={14} className="text-gold-dim" />}
          {label}
        </button>
        {state === "copied" && (
          <p className="flex flex-wrap items-center gap-x-2 text-[12.5px] text-appNavy/65" role="status">
            הפרומט הועתק. הדביקו אותו בשיחה חדשה בקלוד.
            <a
              href={CLAUDE_NEW_CHAT}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-gold-dim hover:text-appNavy"
            >
              פתיחת קלוד
              <ExternalLink size={12} />
            </a>
          </p>
        )}
      </div>

      {state === "manual" && (
        <div className="rounded-xl border border-lineDark bg-cream/40 p-3">
          <p className="text-[12.5px] text-appNavy/70">הדפדפן לא אפשר העתקה אוטומטית. הטקסט מסומן, אפשר להעתיק אותו מכאן.</p>
          <textarea
            ref={boxRef}
            readOnly
            value={prompt}
            dir="rtl"
            rows={8}
            aria-label="הפרומט לקלוד"
            className="mt-2 w-full resize-y rounded-lg border border-lineDark bg-white p-2 font-jbmono text-[11.5px] leading-relaxed text-appNavy/80"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={copyFromBox}
              className="inline-flex items-center gap-1.5 rounded-full border border-lineDark bg-white px-3 py-1.5 text-[12.5px] font-medium text-appNavy transition-colors hover:border-gold"
            >
              <Copy size={13} />
              העתקה
            </button>
            <button
              type="button"
              onClick={() => setState("idle")}
              className="rounded-full px-3 py-1.5 text-[12.5px] text-appNavy/55 hover:text-appNavy"
            >
              סגירה
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
