"use client";

// A process's own page (13.11.2026, processes redesign, stage 2). Built to
// the "מסך 2: דף תהליך" board (ops-runbooks/processes-redesign-design/
// Process.dc.html in claude-backup): who it is, when it runs, who does it
// and the run that is open, in three cards on top; the steps, runs, notes
// from the field, details for the work and the procedure document in tabs.
// Only what stops a run is said on top, in one line.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { CenterDialog } from "@/components/app/Drawer";
import { useToast } from "@/components/app/toast/ToastProvider";
import { describeRhythm } from "@/lib/process-rhythm";
import { runBlockerKey } from "@/lib/process-readiness";
import type { ProcessStep } from "@/lib/process-rules";
import {
  approveProcessVersionAction,
  discardProcessVersionAction,
  removeProcessAction,
  setProcessKindAction,
  setProcessStatusAction,
} from "../process-actions";
import { CheckLines, Lessons, ProcedureEditor, ProcessForm, StartRunForm, StrangerBlock, type FormOptions, type PanelProcess } from "./ProcessesPanel";
import { ProcessCheckForm } from "./ProcessCheckForm";
import { RhythmEditor } from "./RhythmEditor";

type Tx = (key: string, values?: Record<string, string | number>) => string;
type Tab = "steps" | "runs" | "lessons" | "work" | "document";
type Upcoming = { date: string; opens: string; movedFrom: string | null };

const PILL: Record<string, string> = {
  ACTIVE: "bg-app-success-soft text-app-success",
  DRAFT: "bg-app-info-soft text-app-info",
  PAUSED: "bg-app-neutral-soft text-app-text-secondary",
  RETIRED: "bg-app-neutral-soft text-app-text-secondary",
};

export function ProcessPage({
  clientId,
  clientName,
  process: p,
  form,
  upcoming,
  stepsLead,
  canApprove,
  openRhythm,
  userId,
}: {
  userId: string;
  clientId: string;
  clientName: string;
  process: PanelProcess;
  form: FormOptions;
  upcoming: Upcoming[];
  stepsLead: number;
  canApprove: boolean;
  openRhythm: boolean;
}) {
  const t = useTranslations("clients.processes.page") as unknown as Tx;
  const tp = useTranslations("clients.processes") as unknown as Tx;
  const lang = useLocale().startsWith("en") ? "en" : "he";
  const format = useFormatter();
  const router = useRouter();
  const { showToast } = useToast();
  const [tab, setTab] = useState<Tab>("steps");
  const guide = p.kind === "GUIDE";
  const staffName = new Map(form.staff.map((s) => [s.id, s.name]));
  const contactName = new Map(form.contacts.map((c) => [c.id, c.name]));
  const systemName = new Map(form.systems.map((s) => [s.id, s.name]));
  const day = (key: string) => format.dateTime(new Date(`${key.slice(0, 10)}T12:00:00Z`), { weekday: "long", day: "numeric", month: "numeric" });
  const short = (key: string) => format.dateTime(new Date(`${key.slice(0, 10)}T12:00:00Z`), { day: "numeric", month: "numeric" });

  async function act(fn: () => Promise<{ error?: string }>, ok: string, after?: () => void) {
    const r = await fn();
    if (r.error) showToast({ tone: "error", title: t("actionFailed"), description: r.error });
    else {
      showToast({ tone: "success", title: ok });
      after?.();
      router.refresh();
    }
  }

  const steps: ProcessStep[] = p.current?.steps ?? p.draft?.steps ?? [];
  const openRun = p.runs.find((r) => r.status !== "DONE" && r.status !== "ARCHIVED") ?? null;
  const openLessons = p.lessons.filter((l) => l.status === "OPEN");
  const blockerKey = runBlockerKey(p.readiness?.blocker);
  const blocker = p.readiness && !p.readiness.ready ? (blockerKey ? tp(`readiness.blockers.${blockerKey}`) : p.readiness.blocker) : null;
  const approver = p.approverUserId ? staffName.get(p.approverUserId) : p.approverContactId ? `${contactName.get(p.approverContactId) ?? ""}, ${t("atClient")}` : p.approverText;
  const executor = p.executorUserId ? staffName.get(p.executorUserId) : p.executorContactId ? contactName.get(p.executorContactId) : p.executorText;
  const version = p.current?.version ?? null;

  const card = "flex flex-col gap-2.5 rounded-[14px] bg-app-surface-sunken px-5 py-4";
  const label = "text-[13px] font-bold text-app-text-secondary";
  const tabs: [Tab, string][] = guide
    ? [
        ["steps", t("tabs.steps")],
        ["work", t("tabs.work")],
        ["document", t("tabs.document")],
      ]
    : [
        ["steps", t("tabs.steps")],
        ["runs", t("tabs.runs", { count: p.runs.length })],
        ["lessons", t("tabs.lessons", { count: openLessons.length })],
        ["work", t("tabs.work")],
        ["document", t("tabs.document")],
      ];

  return (
    <div className="flex flex-col" data-testid="process-page">
      <nav className="flex flex-wrap items-center gap-2 text-sm text-app-text-secondary" aria-label={t("breadcrumb")}>
        <Link href={`/app/clients/${clientId}?tab=file`} className="hover:underline">
          {clientName}
        </Link>
        <span aria-hidden="true">/</span>
        <Link href={`/app/clients/${clientId}?tab=file&section=processes`} className="hover:underline">
          {t("processes")}
        </Link>
        <span aria-hidden="true">/</span>
        <span className="font-bold text-app-text-primary">{p.code}</span>
      </nav>

      <header className="mt-4 flex flex-col gap-5 rounded-t-[14px] border border-b-0 border-app-border bg-white px-5 pt-6 sm:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-lg font-bold text-app-text-accent">{p.code}</span>
              <h1 className="text-[28px] font-extrabold text-app-text-primary sm:text-[32px]">{p.title}</h1>
              <span className={`rounded-full px-3 py-1 text-sm font-bold ${PILL[p.status] ?? PILL.PAUSED}`}>
                {guide ? t("guide") : tp(`labels.statuses.${p.status}`)}
                {version ? ` · ${t("version", { version })}` : ""}
              </span>
            </div>
            {p.purpose && <p className="text-base text-app-text-secondary">{p.purpose}</p>}
            {blocker && (
              <p className="text-sm font-bold text-app-error" data-testid="process-blocker">
                {blocker}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2.5">
            {!guide && p.status === "ACTIVE" && p.triggerKinds.some((k) => k !== "CONTINUOUS" && k !== "EXTERNAL") && (
              <CenterDialog triggerLabel={t("runNow")} triggerVariant="secondary" eyebrow={`${p.code} ${p.title}`} title={t("runNowTitle")}>
                <div className="px-5 py-6 sm:px-8">
                  <StartRunForm clientId={clientId} process={p} />
                </div>
              </CenterDialog>
            )}
            {!guide && p.routine && (
              <CenterDialog triggerLabel={t("recordCheck")} triggerVariant="secondary" eyebrow={`${p.code} ${p.title}`} title={t("recordCheck")}>
                <div className="px-5 py-6 sm:px-8">
                  <ProcessCheckForm clientId={clientId} processId={p.id} checkText={p.checkText} steps={steps.map((s) => s.title)} />
                </div>
              </CenterDialog>
            )}
            <details className="relative" data-testid="process-page-more">
              <summary aria-label={t("more")} className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-[10px] border border-app-border-strong bg-white text-xl text-app-text-primary">
                ⋯
              </summary>
              <div className="absolute end-0 z-20 mt-1 flex min-w-[14rem] flex-col items-start gap-2.5 rounded-xl border border-app-border bg-white p-3 text-sm shadow-lg">
                <CenterDialog triggerLabel={t("menu.editWhat")} triggerClassName="!text-sm !font-normal !text-app-text-primary" eyebrow={`${p.code} ${p.title}`} title={t("menu.editWhat")}>
                  <div className="px-5 py-6 sm:px-8">
                    <ProcessForm clientId={clientId} existing={p} {...form} only={["what"]} />
                  </div>
                </CenterDialog>
                <CenterDialog triggerLabel={t("menu.knowledge")} triggerClassName="!text-sm !font-normal !text-app-text-primary" eyebrow={`${p.code} ${p.title}`} title={t("menu.knowledge")}>
                  <div className="px-5 py-6 sm:px-8">
                    <ProcessForm clientId={clientId} existing={p} {...form} only={["knowledge"]} />
                  </div>
                </CenterDialog>
                <button type="button" onClick={() => act(() => setProcessKindAction(p.id, guide ? "PROCESS" : "GUIDE", clientId), guide ? t("menu.nowProcess") : t("menu.nowGuide"))} className="text-app-text-primary hover:underline">
                  {guide ? t("menu.toProcess") : t("menu.toGuide")}
                </button>
                {canApprove && p.status === "ACTIVE" && (
                  <button type="button" onClick={() => act(() => setProcessStatusAction(p.id, "PAUSED", clientId), tp("panel.paused"))} className="text-app-text-primary hover:underline">
                    {tp("panel.pause")}
                  </button>
                )}
                {canApprove && p.status === "PAUSED" && (
                  <button type="button" onClick={() => act(() => setProcessStatusAction(p.id, "ACTIVE", clientId), tp("panel.resumed"))} className="text-app-text-primary hover:underline">
                    {tp("panel.resume")}
                  </button>
                )}
                {p.draft?.mayDiscard && (
                  <button
                    type="button"
                    onClick={() => {
                      const d = p.draft!;
                      const ask = p.current ? tp("panel.discardDraftConfirmRuns", { version: d.version, current: p.current.version }) : tp("panel.discardDraftConfirm", { version: d.version });
                      if (window.confirm(ask)) act(() => discardProcessVersionAction(p.id, d.version, clientId), tp("panel.draftDiscarded"));
                    }}
                    className="text-app-text-primary hover:text-app-error"
                  >
                    {tp("panel.discardDraft")}
                  </button>
                )}
                {canApprove && (p.status === "ACTIVE" || p.status === "PAUSED") && (
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(tp("panel.retireConfirm", { code: p.code, title: p.title })))
                        act(() => setProcessStatusAction(p.id, "RETIRED", clientId), tp("panel.retired"), () => router.push(`/app/clients/${clientId}?tab=file&section=processes`));
                    }}
                    className="text-app-text-primary hover:text-app-error"
                  >
                    {tp("panel.retire")}
                  </button>
                )}
                {p.status === "DRAFT" && (
                  <button type="button" onClick={() => act(() => removeProcessAction(p.id, clientId), tp("panel.removed"), () => router.push(`/app/clients/${clientId}?tab=file&section=processes`))} className="text-app-text-primary hover:text-app-error">
                    {tp("panel.remove")}
                  </button>
                )}
              </div>
            </details>
          </div>
        </div>

        <div className={`grid gap-4 ${guide ? "lg:grid-cols-1" : "lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]"}`}>
          {!guide && (
            <section className={card} data-testid="process-when">
              <div className="flex items-center justify-between">
                <span className={label}>{t("when")}</span>
                <CenterDialog triggerLabel={t("change")} triggerClassName="!text-sm !font-bold" defaultOpen={openRhythm} eyebrow={`${p.code} ${p.title}`} title={tp("rhythm.title")}>
                  <RhythmEditor clientId={clientId} processId={p.id} starts={p.rhythmStarts ?? []} dates={p.rhythmDates ?? []} />
                </CenterDialog>
              </div>
              <p className="text-xl font-bold text-app-text-primary">{p.rhythmStarts?.length ? describeRhythm(p.rhythmStarts, p.rhythmDates ?? [], lang) : t("noRhythm")}</p>
              {upcoming.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {upcoming.map((u) => (
                    <span key={u.date} className="rounded-lg bg-white px-2.5 py-1.5 text-sm text-app-text-primary">
                      {day(u.date)}
                      {u.movedFrom && <span className="text-app-warning"> ({u.date < u.movedFrom ? t("earlier") : t("later")})</span>}
                    </span>
                  ))}
                </div>
              )}
              {upcoming.length > 0 && <p className="text-sm text-app-text-secondary">{stepsLead > 0 ? t("opensBefore", { days: stepsLead }) : t("opensOnDay")}</p>}
            </section>
          )}
          <section className={card} data-testid="process-who">
            <div className="flex items-center justify-between">
              <span className={label}>{t("who")}</span>
              <CenterDialog triggerLabel={t("edit")} triggerClassName="!text-sm !font-bold" eyebrow={`${p.code} ${p.title}`} title={t("whoTitle")}>
                <div className="px-5 py-6 sm:px-8">
                  <ProcessForm clientId={clientId} existing={p} {...form} only={["who"]} />
                </div>
              </CenterDialog>
            </div>
            <dl className="grid grid-cols-[72px_minmax(0,1fr)] gap-y-2 text-[15px]">
              <dt className="text-app-text-secondary">{t("owner")}</dt>
              <dd className="font-bold text-app-text-primary">{p.ownerId ? staffName.get(p.ownerId) : t("none")}</dd>
              <dt className="text-app-text-secondary">{t("backup")}</dt>
              <dd className="font-bold text-app-text-primary">{p.backupOwnerId ? staffName.get(p.backupOwnerId) : t("none")}</dd>
              {executor && (
                <>
                  <dt className="text-app-text-secondary">{t("executor")}</dt>
                  <dd className="font-bold text-app-text-primary">{executor}</dd>
                </>
              )}
              <dt className="text-app-text-secondary">{t("approver")}</dt>
              <dd className="font-bold text-app-text-primary">{approver || t("none")}</dd>
            </dl>
          </section>
          {!guide &&
            (openRun ? (
              <section className="flex flex-col gap-2.5 rounded-[14px] bg-app-warning-soft px-5 py-4" data-testid="process-open-run">
                <span className="text-[13px] font-bold text-app-warning">{openRun.dueDate ? t("openRunOn", { date: short(openRun.dueDate) }) : t("openRun")}</span>
                {!!openRun.stepsTotal && (
                  <div className="flex gap-1.5" aria-label={t("progress", { done: openRun.stepsDone ?? 0, total: openRun.stepsTotal })}>
                    {Array.from({ length: openRun.stepsTotal }, (_, i) => (
                      <span key={i} className={`h-2 flex-1 rounded ${i < (openRun.stepsDone ?? 0) ? "bg-app-success" : i === (openRun.stepsDone ?? 0) ? "bg-app-warning" : "bg-app-border"}`} />
                    ))}
                  </div>
                )}
                {openRun.waitingOn && <p className="text-base font-bold text-app-text-primary">{t("waitingOn", { step: openRun.waitingOn })}</p>}
                <Link href={`/app/tasks/${openRun.id}`} className="text-sm font-bold text-app-warning hover:underline">
                  {t("toRun")}
                </Link>
              </section>
            ) : (
              <section className={card}>
                <span className={label}>{t("noOpenRun")}</span>
                <p className="text-sm text-app-text-secondary">{p.runs[0]?.dueDate ? t("lastRun", { date: short(p.runs[0].dueDate) }) : t("neverRan")}</p>
              </section>
            ))}
        </div>

        <div className="flex flex-wrap gap-x-7 text-base" role="tablist">
          {tabs.map(([key, text]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`min-h-[44px] py-3 ${tab === key ? "border-b-[3px] border-app-accent font-bold text-app-text-primary" : "text-app-text-secondary"}`}
              data-testid={`process-tab-${key}`}
            >
              {text}
            </button>
          ))}
        </div>
      </header>

      <div className="rounded-b-[14px] border border-app-border bg-app-surface-page px-5 py-7 sm:px-8">
        {tab === "steps" && (
          <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="flex flex-col">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl font-extrabold text-app-text-primary">{steps.length ? t("stepsCount", { count: steps.length }) : t("noSteps")}</h2>
                {p.isFlow ? (
                  <Link href={`/app/clients/${clientId}/processes/${p.id}/flow`} className="inline-flex min-h-[40px] items-center rounded-[9px] border border-app-border-strong bg-white px-4 text-sm text-app-text-primary">
                    {t("editSteps")}
                  </Link>
                ) : (
                  <CenterDialog triggerLabel={steps.length ? t("editSteps") : t("writeSteps")} triggerVariant="secondary" eyebrow={`${p.code} ${p.title}`} title={t("stepsTitle")}>
                    <div className="px-5 py-6 sm:px-8">
                      <ProcedureEditor clientId={clientId} process={p} systems={form.systems} />
                    </div>
                  </CenterDialog>
                )}
              </div>
              {p.draft && (
                <div className="mb-4 flex flex-col gap-2 rounded-xl bg-app-info-soft px-4 py-3 text-sm" data-testid="process-draft">
                  <p className="font-bold text-app-text-primary">{t("draftWaits", { version: p.draft.version })}</p>
                  {p.draft.checks.length > 0 && <CheckLines checks={p.draft.checks} />}
                  {p.draft.mayApprove && !p.draft.checks.some((c) => c.severity === "BLOCK" && !c.excepted) && (
                    <button type="button" onClick={() => act(() => approveProcessVersionAction(p.id, p.draft!.version, clientId), t("approved"))} className="self-start rounded-[9px] bg-app-surface-nav px-4 py-2 text-sm font-bold text-white">
                      {t("approve")}
                    </button>
                  )}
                </div>
              )}
              <ol className="flex flex-col">
                {steps.map((s, i) => (
                  <li key={i} className="grid grid-cols-[44px_minmax(0,1fr)] gap-4">
                    <div className="flex flex-col items-center">
                      <span className={`flex h-9 w-9 items-center justify-center rounded-full text-[15px] font-extrabold ${s.requiresApproval ? "bg-app-accent text-white" : "bg-app-surface-nav text-white"}`}>{i + 1}</span>
                      {i < steps.length - 1 && <span className="mb-3.5 min-h-5 w-0.5 flex-1 bg-app-border" aria-hidden="true" />}
                    </div>
                    <div className="mb-3.5 flex flex-col gap-2 rounded-xl border border-app-border bg-white px-5 py-4">
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-[17px] font-bold text-app-text-primary">{s.title}</span>
                        {s.offsetBusinessDays !== null && s.offsetBusinessDays !== undefined && <span className="shrink-0 text-sm text-app-text-secondary">{tp("steps.days", { days: s.offsetBusinessDays >= 0 ? `+${s.offsetBusinessDays}` : String(s.offsetBusinessDays) })}</span>}
                      </div>
                      <div className="flex flex-wrap gap-2 text-[13px]">
                        <span className="rounded-md bg-app-neutral-soft px-2 py-0.5">{tp(`labels.stepModes.${s.mode}`)}</span>
                        {s.systemIds.map((id) => (
                          <span key={id} className="rounded-md bg-app-neutral-soft px-2 py-0.5">
                            {systemName.get(id) ?? ""}
                          </span>
                        ))}
                        {s.requiresApproval && <span className="rounded-md bg-app-warning-soft px-2 py-0.5 font-bold text-app-warning">{approver ? t("needsApprovalBy", { name: approver }) : t("needsApproval")}</span>}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <aside className="flex flex-col gap-4">
              {!guide && openLessons.length > 0 && (
                <section className="flex flex-col gap-2.5 rounded-[14px] border border-app-border bg-white px-5 py-4">
                  <h3 className="text-base font-bold text-app-text-primary">{t("fromTheField")}</h3>
                  <Lessons clientId={clientId} lessons={openLessons.slice(0, 1)} canResolve={canApprove || p.ownerId === userId} />
                </section>
              )}
              {!guide && (
                <section className="flex flex-col gap-2 rounded-[14px] border border-app-border bg-white px-5 py-4">
                  <h3 className="text-base font-bold text-app-text-primary">{t("recentRuns")}</h3>
                  {p.runs.length === 0 && <p className="text-sm text-app-text-secondary">{t("neverRan")}</p>}
                  {p.runs.slice(0, 3).map((r) => (
                    <Link key={r.id} href={`/app/tasks/${r.id}`} className="flex justify-between gap-3 text-[15px] hover:underline">
                      <span>{r.dueDate ? short(r.dueDate) : r.title}</span>
                      <span className={r.status === "DONE" ? "font-bold text-app-success" : "font-bold text-app-warning"}>{r.status === "DONE" || r.status === "ARCHIVED" ? t("runDone") : t("runOpenShort")}</span>
                    </Link>
                  ))}
                </section>
              )}
            </aside>
          </div>
        )}

        {tab === "runs" && (
          <ul className="flex flex-col gap-2" data-testid="process-runs">
            {p.runs.length === 0 && <li className="text-sm text-app-text-secondary">{t("neverRan")}</li>}
            {p.runs.map((r) => (
              <li key={r.id}>
                <Link href={`/app/tasks/${r.id}`} className="flex flex-wrap justify-between gap-3 rounded-xl border border-app-border bg-white px-5 py-3 text-[15px] hover:border-app-border-strong">
                  <span className="font-bold text-app-text-primary">{r.dueDate ? day(r.dueDate) : r.title}</span>
                  <span className="text-app-text-secondary">
                    {r.status === "DONE" || r.status === "ARCHIVED" ? t("runDone") : r.stepsTotal ? t("progress", { done: r.stepsDone ?? 0, total: r.stepsTotal }) : t("runOpenShort")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {tab === "lessons" && (
          <div className="rounded-[14px] border border-app-border bg-white px-5 py-4">
            {p.lessons.length ? <Lessons clientId={clientId} lessons={p.lessons} canResolve={canApprove || p.ownerId === userId} /> : <p className="text-sm text-app-text-secondary">{t("noLessons")}</p>}
          </div>
        )}

        {tab === "work" && (
          <div className="max-w-3xl rounded-[14px] border border-app-border bg-white px-5 py-6 sm:px-8" data-testid="process-work">
            <ProcessForm clientId={clientId} existing={p} {...form} only={["work"]} />
          </div>
        )}

        {tab === "document" && (
          <div className="flex max-w-3xl flex-col gap-5" data-testid="process-document">
            {p.latestVersion > 0 && (
              <Link href={`/app/clients/${clientId}/processes/${p.id}/document`} className="self-start text-sm font-bold text-app-text-accent hover:underline">
                {t("openDocument")}
              </Link>
            )}
            {p.doc && <p className="text-sm text-app-text-secondary">{t("docScore", { score: p.doc.score, of: p.doc.of })}</p>}
            {p.stranger && <StrangerBlock stranger={p.stranger} />}
            <div className="rounded-[14px] border border-app-border bg-white px-5 py-6 sm:px-8">
              <ProcessForm clientId={clientId} existing={p} {...form} only={["document"]} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
