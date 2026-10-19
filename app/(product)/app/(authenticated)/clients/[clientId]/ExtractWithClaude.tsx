"use client";
import { useRef, useState } from "react";
import { Check, Copy, ExternalLink, Sparkles } from "lucide-react";

// "חלץ ידע עם קלוד" (org-brain spec 5.1): one press copies a prompt that
// carries the extraction rules and what is already in this client's file.
// The conversation it starts ends with propose_knowledge, and the
// proposals wait on "ממתין לאישור". Same copy mechanics as "קדם עם קלוד"
// on a task (tasks/[id]/AdvanceWithClaude.tsx): the prompt is built on
// the server and copied inside the click, with a box to copy from by hand
// when the browser refuses. Same warning, too: the Team workspace only.

const CLAUDE_NEW_CHAT = "https://claude.ai/new";

export function ExtractWithClaude({ prompt }: { prompt: string }) {
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");
  const boxRef = useRef<HTMLTextAreaElement>(null);

  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
      await navigator.clipboard.writeText(prompt);
      setState("copied");
    } catch {
      setState("manual");
      requestAnimationFrame(() => boxRef.current?.select());
    }
  }

  function copyFromBox() {
    const box = boxRef.current;
    if (!box) return;
    box.select();
    if (document.execCommand("copy")) setState("copied");
  }

  return (
    <div className="flex flex-col gap-2" data-testid="extract-with-claude">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={copy}
          title="מעתיק פרומט עם כללי החילוץ ומה שכבר בתיק. קלוד קורא פגישה או מסמך, מכין איתכם טיוטה, ושולח הצעות לאישור"
          className="inline-flex items-center gap-1.5 rounded-full border border-app-border bg-white px-3 py-1.5 text-[12.5px] font-medium text-app-text-primary transition-colors hover:border-gold"
        >
          {state === "copied" ? <Check size={14} className="text-app-text-accent" /> : <Sparkles size={14} className="text-app-text-accent" />}
          חלץ ידע עם קלוד
        </button>
        {state === "copied" && (
          <p className="flex flex-wrap items-center gap-x-2 text-[12.5px] text-app-text-secondary" role="status">
            הפרומט הועתק. הדביקו אותו בשיחה חדשה בחשבון הארגוני של אנקורה בקלוד.
            <a href={CLAUDE_NEW_CHAT} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-app-text-accent hover:text-app-text-primary">
              פתיחת קלוד
              <ExternalLink size={12} />
            </a>
          </p>
        )}
      </div>
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
            className="mt-2 w-full resize-y rounded-lg border border-app-border bg-white p-2 font-jbmono text-[11.5px] leading-relaxed text-app-text-primary"
          />
          <div className="mt-2 flex items-center gap-2">
            <button type="button" onClick={copyFromBox} className="inline-flex items-center gap-1.5 rounded-full border border-app-border bg-white px-3 py-1.5 text-[12.5px] font-medium text-app-text-primary transition-colors hover:border-gold">
              <Copy size={13} />
              העתקה
            </button>
            <button type="button" onClick={() => setState("idle")} className="rounded-full px-3 py-1.5 text-[12.5px] text-app-text-secondary hover:text-app-text-primary">
              סגירה
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
