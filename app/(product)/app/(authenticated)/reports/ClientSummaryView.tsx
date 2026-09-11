"use client";
import { useState } from "react";

// docs/adr/0001 section 19.14. The prompt text itself is built server-side
// in page.tsx (via lib/client-activity-prompt.ts, using real DB data) and
// handed to this component as a plain prop - this component only owns the
// two client-only interactions (clipboard + file download), same division
// of labor as the rest of this app's server-component-fetches /
// client-component-interacts pattern.
export function ClientSummaryView({ text, filename }: { text: string; filename: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can be unavailable (e.g. non-HTTPS, permissions) -
      // the textarea below is still selectable/copyable manually.
    }
  }

  function download() {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3 rounded-2xl border border-lineDark bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-navy">
          הטקסט מוכן להעתקה - הדביקו אותו ב-ChatGPT או Claude כדי לקבל סיכום קצר לשיתוף עם הלקוח.
        </h2>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={copy}
            className="rounded-full bg-gold-gradient px-4 py-2 text-sm font-medium text-ink"
          >
            {copied ? "הועתק!" : "העתק ללוח"}
          </button>
          <button
            type="button"
            onClick={download}
            className="rounded-full border border-lineDark px-4 py-2 text-sm font-medium text-navy transition-colors hover:border-gold"
          >
            הורדה כקובץ טקסט
          </button>
        </div>
      </div>
      <textarea
        readOnly
        value={text}
        dir="rtl"
        className="h-[480px] w-full resize-y rounded-lg border border-lineDark bg-paper/40 p-4 font-mono text-xs leading-relaxed text-navy outline-none focus:border-gold"
        onFocus={(e) => e.currentTarget.select()}
      />
    </div>
  );
}
