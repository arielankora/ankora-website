"use client";

// The procedure document's tab of a process's page (14.11.2026, processes
// redesign, stage 4), built to the "מסך 6: מסמך הנוהל ודרישות ביקורת" board
// (ops-runbooks/processes-redesign-design/Document.dc.html in claude-backup).
// Every client: the document, its download, and "לעדכן" when it is out of
// date. A client with audit requirements also gets the readiness for an
// audit, "להכין לביקורת", the compliance fields and the stranger test.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useActionForm } from "@/components/app/useActionForm";
import { useToast } from "@/components/app/toast/ToastProvider";
import type { DocumentTab as Data } from "@/lib/app-domain/procedure-audit";
import type { ReadinessItem } from "@/lib/audit-readiness";
import { markProcessFieldNotApplicableAction, updateProcessAction } from "../process-actions";
import type { PanelProcess } from "./ProcessesPanel";

type Tx = (key: string, values?: Record<string, string | number>) => string;

const INPUT = "w-full rounded-[9px] border border-app-border bg-white px-3 py-2.5 text-[15px] font-normal text-app-text-primary";
const CARD = "flex flex-col gap-3 rounded-[14px] border border-app-border bg-white px-[22px] py-5";

export function DocumentTab({ clientId, process: p, data, onTab }: { clientId: string; process: PanelProcess; data: Data; onTab: (tab: "work") => void }) {
  const t = useTranslations("clients.processes.docTab") as unknown as Tx;
  const tp = useTranslations("clients.processes") as unknown as Tx;
  const format = useFormatter();
  const router = useRouter();
  const { showToast } = useToast();
  const [allQuestions, setAllQuestions] = useState(false);
  const [moreFields, setMoreFields] = useState(!!(p.definitions || p.relatedDocs));
  const day = (iso: string) => format.dateTime(new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso), { day: "numeric", month: "numeric", year: "numeric" });
  const base = `/app/clients/${clientId}/processes/${p.id}`;
  const v = data.approved?.version;
  const exportHref = (f: "pdf" | "docx") => `/api/clients/${clientId}/processes/${p.id}/document?format=${f}&lang=he&version=${v}`;
  const steps = p.current?.steps ?? [];
  const open = p.stranger?.open ?? [];

  async function notApplicable(field: string) {
    const r = await markProcessFieldNotApplicableAction(p.id, field, clientId);
    if (r.error) showToast({ tone: "error", title: r.error });
    else {
      showToast({ tone: "success", title: t("markedNotApplicable") });
      router.refresh();
    }
  }

  const action = (it: ReadinessItem) => {
    const link = "text-sm font-bold text-app-text-accent hover:underline";
    switch (it.action) {
      case "compliance":
        return (
          <a href="#compliance" className={link}>
            {t("complete")}
          </a>
        );
      case "steps":
        return (
          <Link href={`${base}/steps`} className={link}>
            {t("toEditor")}
          </Link>
        );
      case "translation":
        return (
          <Link href={`${base}/document`} className={link}>
            {t("toTranslation")}
          </Link>
        );
      case "stranger":
        return (
          <button type="button" onClick={() => setAllQuestions(true)} className={link}>
            {t("toQuestions")}
          </button>
        );
      case "work":
        return (
          <span className="flex gap-1.5 text-sm">
            <button type="button" onClick={() => onTab("work")} className="font-bold text-app-text-accent hover:underline">
              {t("complete")}
            </button>
            <span aria-hidden="true">·</span>
            <button type="button" onClick={() => notApplicable(it.field!)} className="font-bold text-app-text-accent hover:underline" data-testid="mark-not-applicable">
              {t("notApplicable")}
            </button>
          </span>
        );
      default:
        return <span />;
    }
  };

  const staleLine = (r: Data["stale"][number]) =>
    r.key === "approverLeft"
      ? r.step
        ? r.at
          ? t("stale.approverLeftOn", { name: r.name, step: r.step, date: day(r.at) })
          : t("stale.approverLeft", { name: r.name, step: r.step })
        : t("stale.processApproverLeft", { name: r.name })
      : r.key === "rhythmChanged"
        ? t("stale.rhythmChanged", { version: v ?? "" })
        : t("stale.ruleChanged", { title: r.title, date: day(r.at) });

  return (
    <div className={`grid items-start gap-7 ${data.audit ? "lg:grid-cols-[minmax(0,1fr)_440px]" : ""}`} data-testid="process-document">
      <div className="flex flex-col gap-[18px]">
        {data.stale.length > 0 && (
          <section className="flex flex-col gap-2.5 rounded-[14px] bg-app-warning-soft px-5 py-4" data-testid="document-stale">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-base font-extrabold text-app-warning">{t("stale.title")}</h3>
              <Link href={`${base}/steps`} className="inline-flex h-[38px] items-center rounded-[9px] bg-app-surface-nav px-3.5 text-sm font-bold text-white">
                {t("stale.toEditor")}
              </Link>
            </div>
            {data.stale.map((r, i) => (
              <p key={i} className="text-[15px] text-app-warning">
                {staleLine(r)}
              </p>
            ))}
          </section>
        )}

        {data.approved ? (
          <section className="flex flex-wrap items-center justify-between gap-4 rounded-[14px] border border-app-border bg-white px-[22px] py-[18px]">
            <div className="flex flex-col gap-1">
              <h3 className="text-[17px] font-extrabold text-app-text-primary">{t("docTitle", { version: data.approved.version })}</h3>
              <p className="text-sm text-app-text-secondary">
                {[
                  data.approved.approvedAt ? (data.approved.approvedBy ? t("approvedOnBy", { date: day(data.approved.approvedAt), name: data.approved.approvedBy }) : t("approvedOn", { date: day(data.approved.approvedAt) })) : null,
                  t("inForce"),
                  data.approved.english ? t("hebrewAndEnglish") : t("hebrewOnly"),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <div className="flex gap-2.5">
              <a href={exportHref("pdf")} className="inline-flex h-10 items-center rounded-[9px] border border-app-border-strong bg-white px-4 text-sm text-app-text-primary" data-testid="export-pdf">
                PDF
              </a>
              <a href={exportHref("docx")} className="inline-flex h-10 items-center rounded-[9px] border border-app-border-strong bg-white px-4 text-sm text-app-text-primary" data-testid="export-docx">
                Word
              </a>
              <Link href={`${base}/document`} className="inline-flex h-10 items-center rounded-[9px] bg-app-surface-nav px-4 text-sm font-bold text-white" data-testid="procedure-document-link">
                {t("fullDocument")}
              </Link>
            </div>
          </section>
        ) : (
          <p className="rounded-[14px] border border-app-border bg-white px-[22px] py-[18px] text-[15px] text-app-text-secondary">{t("noApproved")}</p>
        )}

        {data.approved && (
          <section className="flex flex-col gap-3.5 rounded-[14px] border border-app-border bg-white px-6 py-7 text-[15px] leading-relaxed sm:px-9" data-testid="document-preview">
            <p className="text-[13px] text-app-text-secondary">{t("previewLine", { code: p.code, version: data.approved.version, level: tp(`labels.classifications.${p.classification ?? "CONFIDENTIAL"}`) })}</p>
            <h3 className="text-[22px] font-extrabold text-app-text-primary">{p.title}</h3>
            {p.purpose && (
              <>
                <h4 className="border-b border-app-border pb-1 font-bold">{t("purpose")}</h4>
                <p>{p.purpose}</p>
              </>
            )}
            {(p.scope || data.audit) && (
              <>
                <h4 className="border-b border-app-border pb-1 font-bold">{t("scope")}</h4>
                {p.scope ? <p>{p.scope}</p> : <p className="text-app-text-tertiary">{t("missing")}</p>}
              </>
            )}
            {steps.length > 0 && (
              <>
                <h4 className="border-b border-app-border pb-1 font-bold">{t("steps")}</h4>
                {steps.map((s, i) => (
                  <p key={i}>
                    {i + 1}. {s.title}
                  </p>
                ))}
              </>
            )}
            <p className="text-[13px] text-app-text-secondary">{t("previewNote")}</p>
          </section>
        )}

        {!data.audit && (
          <p className="text-sm text-app-text-secondary" data-testid="no-audit">
            {t("noAudit")}{" "}
            <Link href={`/app/clients/${clientId}`} className="font-bold text-app-text-accent hover:underline">
              {t("enableAudit")}
            </Link>
          </p>
        )}
      </div>

      {data.audit && data.readiness && (
        <div className="flex flex-col gap-4">
          <section className={CARD} data-testid="audit-readiness">
            <div className="flex items-center justify-between">
              <h3 className="text-[17px] font-extrabold text-app-text-primary">{t("readiness")}</h3>
              {data.readiness.missing ? (
                <span className="rounded-full bg-app-warning-soft px-3 py-1 text-sm font-bold text-app-warning">{t("missingCount", { count: data.readiness.missing })}</span>
              ) : (
                <span className="rounded-full bg-app-success-soft px-3 py-1 text-sm font-bold text-app-success">{t("ready")}</span>
              )}
            </div>
            {data.readiness.items.map((it) => (
              <div key={it.key} className="grid grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-2.5 text-[15px]" data-testid={`readiness-${it.key}`} data-ok={it.ok}>
                <span className={`flex h-[22px] w-[22px] items-center justify-center rounded-full text-[13px] font-extrabold ${it.ok ? "bg-app-success-soft text-app-success" : "bg-app-warning-soft text-app-warning"}`}>{it.ok ? "✓" : "!"}</span>
                <span>{t(`items.${it.text.key}`, it.text.key === "classificationOk" ? { level: tp(`labels.classifications.${it.text.values?.level ?? "CONFIDENTIAL"}`) } : it.text.values)}</span>
                {it.ok ? <span /> : action(it)}
              </div>
            ))}
            {data.prepPrompt && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(data.prepPrompt!);
                    showToast({ tone: "success", title: t("promptCopied") });
                  } catch {
                    showToast({ tone: "error", title: t("promptNotCopied") });
                  }
                }}
                className="mt-1 h-[42px] rounded-[10px] bg-app-surface-nav text-[15px] font-bold text-white"
                data-testid="prepare-for-audit"
              >
                {t("prepare")}
              </button>
            )}
            <p className="text-[13px] leading-normal text-app-text-secondary">{t("prepareNote")}</p>
          </section>

          <ComplianceForm clientId={clientId} process={p} more={moreFields} setMore={setMoreFields} />

          {open.length > 0 && (
            <section className="flex flex-col gap-2 rounded-[14px] bg-app-surface-sunken px-5 py-[18px]" data-testid="document-stranger">
              <h3 className="text-[15px] font-bold text-app-text-primary">{t("strangerTitle", { count: open.length })}</h3>
              {(allQuestions ? open : open.slice(0, 2)).map((q) => (
                <p key={q.id} className="text-sm text-app-text-secondary">
                  {q.step ? t("strangerAtStep", { step: q.step, question: q.question }) : q.question}
                </p>
              ))}
              {!allQuestions && open.length > 2 && (
                <button type="button" onClick={() => setAllQuestions(true)} className="self-start text-sm font-bold text-app-text-accent hover:underline">
                  {t("allQuestions")}
                </button>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function ComplianceForm({ clientId, process: p, more, setMore }: { clientId: string; process: PanelProcess; more: boolean; setMore: (v: boolean) => void }) {
  const t = useTranslations("clients.processes.docTab") as unknown as Tx;
  const tp = useTranslations("clients.processes") as unknown as Tx;
  const { showToast } = useToast();
  const { onSubmit, pending, error } = useActionForm(updateProcessAction, () => showToast({ tone: "success", title: t("saved") }));
  const label = "flex flex-col gap-1.5 text-sm font-bold text-app-text-primary";
  return (
    <form id="compliance" onSubmit={onSubmit} className={`${CARD} scroll-mt-24`} data-testid="compliance-form">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="id" value={p.id} />
      <input type="hidden" name="_parts" value="compliance" />
      <input type="hidden" name="title" value={p.title} />
      <h3 className="text-[17px] font-extrabold text-app-text-primary">{t("complianceTitle")}</h3>
      <label className={label}>
        {t("scope")}
        <textarea name="scope" rows={2} defaultValue={p.scope ?? ""} placeholder={t("scopePlaceholder")} className={INPUT} />
      </label>
      <label className={label}>
        {t("controls")}
        <input name="controlRefs" dir="ltr" defaultValue={p.controlRefs?.join(", ") ?? ""} placeholder="CC6.2, CC6.3" className={INPUT} />
      </label>
      <label className={label}>
        {t("classification")}
        <select name="classification" defaultValue={p.classification ?? "CONFIDENTIAL"} className={INPUT}>
          {(["CONFIDENTIAL", "INTERNAL", "PUBLIC"] as const).map((c) => (
            <option key={c} value={c}>
              {tp(`labels.classifications.${c}`)}
            </option>
          ))}
        </select>
      </label>
      {more ? (
        <>
          <label className={label}>
            {t("definitions")}
            <textarea name="definitions" rows={2} defaultValue={p.definitions ?? ""} className={INPUT} />
          </label>
          <label className={label}>
            {t("relatedDocs")}
            <textarea name="relatedDocs" rows={2} defaultValue={p.relatedDocs ?? ""} className={INPUT} />
          </label>
        </>
      ) : (
        <>
          <input type="hidden" name="definitions" value={p.definitions ?? ""} />
          <input type="hidden" name="relatedDocs" value={p.relatedDocs ?? ""} />
          <button type="button" onClick={() => setMore(true)} className="self-start text-sm font-bold text-app-text-accent hover:underline">
            {t("moreFields")}
          </button>
        </>
      )}
      {error && <p className="text-sm text-app-error">{error}</p>}
      <button type="submit" disabled={pending} className="h-10 rounded-[9px] border border-app-border-strong bg-white text-sm text-app-text-primary disabled:opacity-50">
        {pending ? t("saving") : t("save")}
      </button>
    </form>
  );
}
