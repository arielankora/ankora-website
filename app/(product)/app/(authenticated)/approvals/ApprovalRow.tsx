"use client";
import { useState, useTransition } from "react";
import { useToast } from "@/components/app/toast/ToastProvider";
import type { ApprovalKind, KindTone, RowActions } from "@/lib/approvals";
import type { ApprovalPreview } from "@/lib/approvals-preview";
import { decideApprovalAction } from "./actions";

// One row of "אישורים": what it is, for whom, how long it has waited,
// and the decision in place. A reject that removes something (a proposed
// rule, a summary draft) asks a second time; one that needs a reason
// opens a line for it, as on the screen it came from.

export const TONE_CLASSES: Record<KindTone, string> = {
  error: "bg-app-error-soft text-app-error",
  warning: "bg-app-warning-soft text-app-warning",
  accent: "bg-app-accent-soft text-app-text-accent",
  info: "bg-app-info-soft text-app-info",
  success: "bg-app-success-soft text-app-success",
  neutral: "bg-app-neutral-soft text-app-text-secondary",
};

export function KindLabel({ label, tone }: { label: string; tone: KindTone }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE_CLASSES[tone]}`}>{label}</span>;
}

export type RowView = {
  kind: ApprovalKind;
  id: string;
  version?: number;
  clientId: string | null;
  clientName: string | null;
  title: string;
  detail?: string | null;
  waited: string;
  by?: string | null;
  href: string;
  actions: RowActions;
  blocked?: string | null;
  preview?: ApprovalPreview | null;
  label: string;
  tone: KindTone;
  showLabel: boolean;
};

export function ApprovalRow({ row }: { row: RowView }) {
  const { showToast } = useToast();
  const [pending, start] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const decide = (decision: "approve" | "reject") =>
    start(async () => {
      const r = await decideApprovalAction({ kind: row.kind, id: row.id, version: row.version, decision, note, clientId: row.clientId });
      if (r.error) {
        showToast({ tone: "error", title: decision === "approve" ? "האישור נכשל" : "הפעולה נכשלה", description: r.error });
        return;
      }
      setRejecting(false);
      setDone(decision === "approve" ? "אושר" : row.actions.reject?.label ?? "נדחה");
      showToast({ tone: decision === "approve" ? "success" : "info", title: decision === "approve" ? "אושר" : "בוצע", description: row.title.slice(0, 80) });
    });

  const reject = row.actions.reject;

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3.5" data-testid="approval-row" data-kind={row.kind}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {row.showLabel && <KindLabel label={row.label} tone={row.tone} />}
          <a href={row.href} className="text-[14px] font-medium text-app-text-primary hover:text-app-text-accent hover:underline">
            {row.title}
          </a>
        </div>
        {row.detail && <p className="mt-1 text-[12.5px] leading-relaxed text-app-text-secondary">{row.detail}</p>}
        {row.blocked && (
          <p className="mt-1 text-[12.5px] text-app-warning">
            {row.blocked}
            {row.kind === "procedure" && (
              <>
                {" "}
                <a href={row.href} className="font-medium text-app-text-accent hover:underline">
                  לתהליך
                </a>
              </>
            )}
          </p>
        )}
        {row.preview && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="mt-1.5 text-[12.5px] font-medium text-app-text-accent hover:underline"
            data-testid="approval-preview-toggle"
          >
            {open ? "הסתרה" : row.preview.toggle}
          </button>
        )}
        {row.preview && open && <PreviewBody preview={row.preview} />}
        <p className="mt-1 text-[11.5px] text-app-text-tertiary">
          {[row.clientName, row.by ? `מ${row.by}` : null, row.waited].filter(Boolean).join(" · ")}
        </p>
        {rejecting && reject?.note && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="למה, בשורה אחת"
              aria-label="סיבה"
              className="min-w-[14rem] flex-1 rounded-lg border border-app-border bg-white px-3 py-1.5 text-[13px] text-app-text-primary"
            />
            <button type="button" disabled={pending || !note.trim()} onClick={() => decide("reject")} className="rounded-full border border-app-border px-3 py-1 text-[12.5px] text-app-error disabled:opacity-40">
              {pending ? "שומר..." : reject.label}
            </button>
            <button type="button" onClick={() => setRejecting(false)} className="text-[12px] text-app-text-tertiary hover:underline">
              ביטול
            </button>
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3 text-[12.5px]">
        {done ? (
          <span className="text-app-text-tertiary">{done}</span>
        ) : rejecting && reject && !reject.note ? (
          <>
            <button type="button" disabled={pending} onClick={() => decide("reject")} className="font-medium text-app-error hover:underline disabled:opacity-40">
              {pending ? "שומר..." : `כן, ${reject.label}`}
            </button>
            <button type="button" onClick={() => setRejecting(false)} className="text-app-text-tertiary hover:underline">
              ביטול
            </button>
          </>
        ) : (
          <>
            {row.actions.approve && (
              <button
                type="button"
                disabled={pending}
                onClick={() => decide("approve")}
                className="rounded-full bg-app-surface-nav px-3.5 py-1.5 font-medium text-cream disabled:opacity-40"
              >
                {pending ? "שומר..." : row.actions.approve}
              </button>
            )}
            {reject && !rejecting && (
              <button type="button" disabled={pending} onClick={() => setRejecting(true)} className="text-app-text-secondary hover:text-app-error disabled:opacity-40">
                {reject.label}
              </button>
            )}
            {!row.actions.approve && !reject && (
              <a href={row.href} className="font-medium text-app-text-accent hover:underline">
                לבדיקה
              </a>
            )}
          </>
        )}
      </div>
    </li>
  );
}

/// The item in full, under its row: read before deciding.
function PreviewBody({ preview }: { preview: ApprovalPreview }) {
  return (
    <div className="mt-2 space-y-2.5 rounded-lg border border-app-border bg-app-surface-sunken px-3 py-2.5" data-testid="approval-preview">
      {preview.problems.length > 0 && (
        <div>
          <p className="text-[12px] font-medium text-app-error">מה מעכב את האישור</p>
          {preview.problems.map((line, i) => (
            <p key={i} className="mt-0.5 text-[12.5px] leading-relaxed text-app-error">
              {line}
            </p>
          ))}
        </div>
      )}
      {preview.sections.map((sec, i) => (
        <div key={i}>
          {sec.heading && <p className="text-[12px] font-medium text-app-text-secondary">{sec.heading}</p>}
          {sec.lines.map((line, j) => (
            <p key={j} className="mt-0.5 whitespace-pre-line text-[12.5px] leading-relaxed text-app-text-primary">
              {line}
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}
