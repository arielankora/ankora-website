"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, Languages } from "lucide-react";
import { useToast } from "@/components/app/toast/ToastProvider";
import { approveProcedureTranslationAction } from "../../../../process-actions";

// The English version of a procedure document (23.10.2026): a prompt to
// copy into Claude, which translates through MCP and saves a draft, and a
// manager's approval. Same copy mechanics as "חלץ ידע עם קלוד".

const CLAUDE_NEW_CHAT = "https://claude.ai/new";

export function TranslateWithClaude({ prompt, label }: { prompt: string; label: string }) {
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

  return (
    <div className="flex flex-col gap-2" data-testid="translate-with-claude">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-full border border-app-border bg-white px-3 py-1.5 text-[12.5px] font-medium text-app-text-primary transition-colors hover:border-gold"
        >
          {state === "copied" ? <Check size={14} className="text-app-text-accent" /> : <Languages size={14} className="text-app-text-accent" />}
          {label}
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
        <textarea ref={boxRef} readOnly value={prompt} rows={5} dir="rtl" className="w-full rounded-lg border border-app-border bg-cream/40 p-2 text-xs" aria-label="הפרומט להעתקה" />
      )}
    </div>
  );
}

export function ApproveTranslation({ processId, version, clientId, disabled }: { processId: string; version: number; clientId: string; disabled: boolean }) {
  const [pending, start] = useTransition();
  const { showToast } = useToast();
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={disabled || pending}
      onClick={() =>
        start(async () => {
          const r = await approveProcedureTranslationAction(processId, version, clientId);
          if (r.error) showToast({ tone: "error", title: "האישור נכשל", description: r.error });
          else {
            showToast({ tone: "success", title: "התרגום אושר" });
            router.refresh();
          }
        })
      }
      className="rounded-full bg-app-surface-nav px-3 py-1 text-[12px] font-medium text-cream disabled:opacity-50"
      data-testid="approve-translation"
    >
      {pending ? "מאשר..." : "אישור התרגום"}
    </button>
  );
}
