"use client";
import { StatusBadge } from "@/components/app/StatusBadge";
import { KNOWLEDGE_STATUS_LABELS, type KnowledgeStatusLike } from "@/lib/knowledge";

// The pieces every section of the client file draws the same way: the
// form field, the status line with what would close it, and the sources.
// Shared so people, organizations and systems cannot drift apart.

export type SourceOption = { code: string; title: string };

export const STATUS_TONE: Record<KnowledgeStatusLike, "green" | "amber" | "gray" | "red"> = {
  CONFIRMED: "green",
  UNCERTAIN: "amber",
  MISSING: "red",
  SUPERSEDED: "gray",
};

export const INPUT = "mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-appNavy outline-none focus:border-gold";
export const LABEL = "block text-xs font-medium text-appNavy/60";

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className={LABEL}>{label}</span>
      {children}
    </label>
  );
}

/// The item's sources, as typed codes, with the register right under the
/// field so nobody has to remember what S4 was.
export function SourcesField({ options, defaultValue, status }: { options: SourceOption[]; defaultValue?: string; status: KnowledgeStatusLike }) {
  return (
    <div>
      <Field label={status === "MISSING" ? "מקורות" : "מקורות *"}>
        <input name="sources" dir="ltr" defaultValue={defaultValue ?? ""} placeholder="S1 08:13, S3" className={INPUT} />
      </Field>
      {options.length === 0 ? (
        <p className="mt-1 text-[11px] text-appNavy/40">אין עדיין מקורות במרשם. מוסיפים אותם ב&quot;מרשם מקורות&quot; במסך הלקוח.</p>
      ) : (
        // The most recent ones: a long register is read in its own panel.
        <p className="mt-1 text-[11px] text-appNavy/40">
          {options
            .slice(-8)
            .map((o) => `${o.code} ${o.title}`)
            .join(" · ")}
          {options.length > 8 && " · ..."}
        </p>
      )}
    </div>
  );
}

export function SourceCodes({ sources, options }: { sources: string[]; options: SourceOption[] }) {
  if (sources.length === 0) return null;
  const titles = new Map(options.map((o) => [o.code, o.title]));
  return (
    <p className="mt-1 text-[11px] text-appNavy/45" dir="ltr">
      {sources.map((s, i) => (
        <span key={s} title={titles.get(s.split(" ")[0])}>
          {i > 0 && ", "}
          {s}
        </span>
      ))}
    </p>
  );
}

export function StatusLine({ status, toResolve }: { status: KnowledgeStatusLike; toResolve: string | null }) {
  if (status === "CONFIRMED") return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-appNavy/60">
      <StatusBadge label={KNOWLEDGE_STATUS_LABELS[status]} tone={STATUS_TONE[status]} />
      {toResolve && <span>{toResolve}</span>}
    </div>
  );
}
