"use client";
import { approvalAnchor } from "@/lib/approval-links";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/app/toast/ToastProvider";
import type { ApprovalKind, KindTone, RowActions } from "@/lib/approvals";
import type { ApprovalPreview } from "@/lib/approvals-preview";
import type { StepOp } from "@/lib/next-steps";
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

/// The failing checks a row lists before the rest waits in the preview.
const MAX_FAILING = 5;

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
  failing?: string[] | null;
  preview?: ApprovalPreview | null;
  label: string;
  tone: KindTone;
  showLabel: boolean;
  recommend?: { text: string; why: string | null } | null;
  op?: StepOp | null;
  go?: { label: string; href: string } | null;
};

export function ApprovalRow({ row }: { row: RowView }) {
  const t = useTranslations("approvals");
  const { showToast } = useToast();
  const [pending, start] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const decide = (decision: "approve" | "reject") =>
    start(async () => {
      const r = await decideApprovalAction({ kind: row.kind, id: row.kind === "process" ? row.id.split(":")[0] : row.id, version: row.version, decision, note, clientId: row.clientId, op: row.op ?? null });
      if (r.error) {
        showToast({ tone: "error", title: decision === "approve" ? t("row.approveFailed") : t("row.actionFailed"), description: r.error });
        return;
      }
      setRejecting(false);
      const did = row.kind === "process" ? t("row.done") : t("row.approved");
      setDone(decision === "approve" ? did : (row.actions.reject?.label ?? t("row.rejected")));
      showToast({ tone: decision === "approve" ? "success" : "info", title: decision === "approve" ? did : t("row.done"), description: row.title.slice(0, 80) });
    });

  const reject = row.actions.reject;

  return (
    <li id={approvalAnchor(row.kind, row.id)} className="-mx-5 flex flex-wrap items-start justify-between gap-3 px-5 py-3.5 scroll-mt-24 target:bg-app-accent-soft" data-testid="approval-row" data-kind={row.kind}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {row.showLabel && <KindLabel label={row.label} tone={row.tone} />}
          <a href={row.href} dir="auto" className="text-[14px] font-medium text-app-text-primary hover:text-app-text-accent hover:underline">
            {row.title}
          </a>
        </div>
        {row.detail && <p dir="auto" className="mt-1 text-[12.5px] leading-relaxed text-app-text-secondary">{row.detail}</p>}
        {row.recommend && (
          <p className="mt-1 text-[12.5px] leading-relaxed text-app-text-primary" data-testid="approval-recommend">
            <span className="font-medium">{t("row.recommend", { text: row.recommend.text })}</span>
            {row.recommend.why && <span className="text-app-text-secondary"> {row.recommend.why}</span>}
          </p>
        )}
        {row.blocked && (
          <p className="mt-1 text-[12.5px] text-app-warning">
            {row.blocked}
            {row.kind === "procedure" && (
              <>
                {" "}
                <a href={row.href} className="font-medium text-app-text-accent hover:underline">
                  {t("row.toProcess")}
                </a>
              </>
            )}
          </p>
        )}
        {/* Which check fails, and in which step, without opening the
            procedure (3.11.2026). The rest is under "הצגת הנוהל". */}
        {row.failing && row.failing.length > 0 && (
          <ul className="mt-1 list-disc space-y-0.5 ps-5 text-[12.5px] leading-relaxed text-app-error" data-testid="approval-failing">
            {row.failing.slice(0, MAX_FAILING).map((line, i) => (
              <li key={i}>{line}</li>
            ))}
            {row.failing.length > MAX_FAILING && <li className="list-none text-app-text-secondary">{t("row.moreFailing", { count: String(row.failing.length - MAX_FAILING), toggle: t(`preview.toggle.${row.preview?.toggleKey ?? "procedure"}`) })}</li>}
          </ul>
        )}
        {row.preview && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="mt-1.5 text-[12.5px] font-medium text-app-text-accent hover:underline"
            data-testid="approval-preview-toggle"
          >
            {open ? t("row.hide") : t(`preview.toggle.${row.preview.toggleKey}`)}
          </button>
        )}
        {row.preview && open && <PreviewBody preview={row.preview} />}
        <p className="mt-1 text-[11.5px] text-app-text-tertiary">
          {[row.clientName, row.by ? t("row.from", { name: row.by }) : null, row.waited].filter(Boolean).join(" · ")}
        </p>
        {rejecting && reject?.note && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("row.reasonPlaceholder")}
              aria-label={t("row.reasonLabel")}
              className="min-w-[14rem] flex-1 rounded-lg border border-app-border bg-white px-3 py-1.5 text-[13px] text-app-text-primary"
            />
            <button type="button" disabled={pending || !note.trim()} onClick={() => decide("reject")} className="rounded-full border border-app-border px-3 py-1 text-[12.5px] text-app-error disabled:opacity-40">
              {pending ? t("row.saving") : reject.label}
            </button>
            <button type="button" onClick={() => setRejecting(false)} className="text-[12px] text-app-text-tertiary hover:underline">
              {t("row.cancel")}
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
              {pending ? t("row.saving") : t("row.confirm", { label: reject.label })}
            </button>
            <button type="button" onClick={() => setRejecting(false)} className="text-app-text-tertiary hover:underline">
              {t("row.cancel")}
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
                {pending ? t("row.saving") : row.actions.approve}
              </button>
            )}
            {reject && !rejecting && (
              <button type="button" disabled={pending} onClick={() => setRejecting(true)} className="text-app-text-secondary hover:text-app-error disabled:opacity-40">
                {reject.label}
              </button>
            )}
            {!row.actions.approve && row.go && (
              <a href={row.go.href} className="rounded-full bg-app-surface-nav px-3.5 py-1.5 font-medium text-cream" data-testid="approval-go">
                {row.go.label}
              </a>
            )}
            {!row.actions.approve && !row.go && !reject && (
              <a href={row.href} className="font-medium text-app-text-accent hover:underline">
                {t("row.open")}
              </a>
            )}
            {!reject && (row.actions.approve || row.go) && (
              <a href={row.href} className="text-app-text-secondary hover:text-app-text-primary hover:underline">
                {t("row.otherwise")}
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
  const t = useTranslations("approvals");
  return (
    <div className="mt-2 space-y-2.5 rounded-lg border border-app-border bg-app-surface-sunken px-3 py-2.5" data-testid="approval-preview">
      {preview.problems.length > 0 && (
        <div>
          <p className="text-[12px] font-medium text-app-error">{t("row.blockingTitle")}</p>
          {preview.problems.map((line, i) => (
            <p key={i} className="mt-0.5 text-[12.5px] leading-relaxed text-app-error">
              {line}
            </p>
          ))}
        </div>
      )}
      {preview.sections.map((sec, i) => (
        <div key={i}>
          {sec.headingKey && <p className="text-[12px] font-medium text-app-text-secondary">{t(`preview.headings.${sec.headingKey}`)}</p>}
          {sec.lines.map((line, j) => (
            <p key={j} dir="auto" className="mt-0.5 whitespace-pre-line text-[12.5px] leading-relaxed text-app-text-primary">
              {line}
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}
