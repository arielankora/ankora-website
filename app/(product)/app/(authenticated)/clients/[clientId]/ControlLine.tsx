"use client";
import { useState } from "react";
import type { ControlKey, ControlPart } from "@/lib/client-control";

// The control line at the top of a client (spec 7.6): where the handover
// stands and what needs a person, in one line. A count that has names
// behind it opens them, under the line, and links to the section that
// holds them: the line answers "how many", one click answers "which".

/// Where each count lives in the file tab.
const SECTION: Partial<Record<ControlKey, string>> = {
  processes: "processes",
  completeness: "processes",
  needsReview: "processes",
  noBackup: "processes",
  exceptionsInForce: "rules",
  exceptionsRequested: "rules",
};

export function ControlLine({ parts, details = {}, clientId }: { parts: ControlPart[]; details?: Partial<Record<ControlKey, string[]>>; clientId?: string }) {
  const [open, setOpen] = useState<ControlKey | null>(null);
  if (parts.length === 0) return null;
  const shown = open ? (details[open] ?? []) : [];
  const anchor = open ? SECTION[open] : undefined;
  return (
    <div>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-app-text-secondary" aria-label="בקרה">
        {parts.map((p, i) => {
          const names = p.key ? details[p.key] : undefined;
          const tone = p.warn ? "font-medium text-app-warning" : "";
          return (
            <span key={i} className="flex items-center gap-x-2">
              {i > 0 && <span className="text-app-text-tertiary">·</span>}
              {names?.length ? (
                <button
                  type="button"
                  onClick={() => setOpen(open === p.key ? null : p.key!)}
                  aria-expanded={open === p.key}
                  className={`underline decoration-dotted underline-offset-2 hover:text-app-text-primary ${tone} ${open === p.key ? "text-app-text-primary" : ""}`}
                  data-testid={`control-${p.key}`}
                >
                  {p.text}
                </button>
              ) : (
                <span className={tone || undefined}>{p.text}</span>
              )}
            </span>
          );
        })}
      </p>
      {open && shown.length > 0 && (
        <div className="mt-2 rounded-lg border border-app-border bg-white px-3 py-2 text-xs text-app-text-secondary" data-testid="control-details">
          <ul className="space-y-0.5">
            {shown.map((n, i) => (
              <li key={i}>• {n}</li>
            ))}
          </ul>
          {clientId && (
            <a href={`/app/clients/${clientId}?tab=file${anchor ? `#${anchor}` : ""}`} className="mt-1.5 inline-block text-app-text-accent hover:underline">
              לתיק הלקוח
            </a>
          )}
        </div>
      )}
    </div>
  );
}
