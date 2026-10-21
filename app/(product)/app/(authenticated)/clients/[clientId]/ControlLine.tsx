"use client";
import { useState } from "react";
import type { ControlDetail, ControlKey, ControlPart } from "@/lib/client-control";

// The control line at the top of a client (spec 7.6): where the handover
// stands and what needs a person, in one line. A count that has names
// behind it opens them, under the line, and links to the section that
// holds them: the line answers "how many", one click answers "which", and
// a click on a name opens that item in the file, where it is fixed.

/// Where each count lives in the file tab.
const SECTION: Partial<Record<ControlKey, string>> = {
  processes: "processes",
  completeness: "processes",
  needsReview: "processes",
  scheduledNoDate: "processes",
  noBackup: "processes",
  exceptionsInForce: "rules",
  exceptionsRequested: "rules",
};

/// `approvalsHref`: "אישורים" for this client (20.10.2026), where the
/// uncertain items, the rules and the procedures above are also decided.
export function ControlLine({
  parts,
  details = {},
  clientId,
  approvalsHref,
}: {
  parts: ControlPart[];
  details?: Partial<Record<ControlKey, ControlDetail[]>>;
  clientId?: string;
  approvalsHref?: string;
}) {
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
        {approvalsHref && (
          <span className="flex items-center gap-x-2">
            <span className="text-app-text-tertiary">·</span>
            <a href={approvalsHref} className="text-app-text-accent hover:underline" data-testid="control-approvals">
              לאישורים ולבדיקה
            </a>
          </span>
        )}
      </p>
      {open && shown.length > 0 && (
        <div className="mt-2 rounded-lg border border-app-border bg-white px-3 py-2 text-xs text-app-text-secondary" data-testid="control-details">
          <ul className="space-y-0.5">
            {shown.map((n, i) => (
              <li key={i}>
                •{" "}
                {n.id && clientId ? (
                  <a href={`/app/clients/${clientId}?tab=file#item-${n.id}`} className="text-app-text-primary underline decoration-dotted underline-offset-2 hover:text-app-text-accent" data-testid="control-detail-link">
                    {n.text}
                  </a>
                ) : (
                  n.text
                )}
                {n.note && <span className="text-app-text-tertiary"> · {n.note}</span>}
              </li>
            ))}
          </ul>
          {clientId && (
            <a href={`/app/clients/${clientId}?tab=file${anchor ? `#${anchor}` : ""}`} className="mt-1.5 inline-block text-app-text-accent hover:underline">
              לתיק הלקוח
            </a>
          )}
          {approvalsHref && (
            <a href={approvalsHref} className="ms-3 mt-1.5 inline-block text-app-text-accent hover:underline">
              לאישורים
            </a>
          )}
        </div>
      )}
    </div>
  );
}
