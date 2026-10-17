import type { ControlPart } from "@/lib/client-control";

// The control line at the top of a client (spec 7.6): where the handover
// stands and what needs a person, in one line. Server component.

export function ControlLine({ parts }: { parts: ControlPart[] }) {
  if (parts.length === 0) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-appNavy/60" aria-label="בקרה">
      {parts.map((p, i) => (
        <span key={i} className="flex items-center gap-x-2">
          {i > 0 && <span className="text-appNavy/25">·</span>}
          <span className={p.warn ? "font-medium text-warning" : undefined}>{p.text}</span>
        </span>
      ))}
    </p>
  );
}
