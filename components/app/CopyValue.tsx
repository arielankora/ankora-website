"use client";

import { useState } from "react";

// A read-only value plus a copy button. Same division of labor as
// reports/ClientSummaryView.tsx: the text is produced on the server and
// handed down as a prop, and this component owns only the one
// client-side interaction.
//
// The value stays selectable regardless, because the Clipboard API is
// unavailable on non-HTTPS origins and can be refused by permissions -
// so a failed copy degrades to "select it yourself", never to a dead
// button next to text you cannot reach.
export function CopyValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Intentionally silent - the value above is still selectable.
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-lineDark bg-cream-dim px-3 py-2">
      <code dir="ltr" className="min-w-0 flex-1 truncate text-start text-xs text-appNavy/80">
        {value}
      </code>
      <button
        type="button"
        onClick={copy}
        aria-label={label}
        className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-appNavy/60 transition-colors hover:bg-appNavy/5 hover:text-appNavy"
      >
        {copied ? "הועתק" : "העתק"}
      </button>
    </div>
  );
}
