"use client";
import { taskHref } from "../list-query";
import Link from "next/link";
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { useActionForm } from "@/components/app/useActionForm";
import { useToast } from "@/components/app/toast/ToastProvider";
import { addTaskStepAction, applyTaskTemplateAction, recordClientApprovalAction, setTaskStepDoneAction } from "./actions";
import type { TaskStatus } from "@prisma/client";
import { CenterDialog } from "@/components/app/Drawer";
import { MessageClient, type ComposerProps } from "@/components/app/MessageClient";
import { APPROVAL_HOWS, type ApprovalHow } from "@/lib/step-approval";

// Tasks phase 5: the steps of a task.
//
// One level, and the reason is the shape of the work rather than a
// limitation. Tasks here live for days, not quarters. What a person
// needs is not a project tree, it is the four things they have to
// remember about this one task, in the order they thought of them.
//
// So it reads as a checklist and behaves as one. What makes it more
// than a checklist is that each line IS a task: it can carry its own
// assignee, its own deadline and its own timer, and it opens on its own
// screen when it needs to. Nobody has to learn a second concept for
// "a thing that has to happen".
//
// **Adding one asks for a title and nothing else.** The drawer that
// creates a full task asks for seven fields, and that is right for a
// task somebody is committing to. A step is a thought at the moment of
// having it, and a form is how a thought gets lost. Everything else
// about a step is editable afterwards, on the step's own screen.

export type Step = {
  id: string;
  title: string;
  status: TaskStatus;
  dueDate: string | null;
  assignedToName: string | null;
  /// Spec 5.3: a step that waits for a signature, and whose.
  approverName?: string | null;
  /// Who signed it and when, once signed.
  approvedByName?: string | null;
  approvedAt?: string | null;
  /// 14.11.2026 (processes redesign, stage 3, "Run.dc.html"): a step a
  /// contact at the client approves, and how they did, once written down.
  clientApprover?: string | null;
  clientApproval?: { at: string; how: string; link: string | null } | null;
};

/// The message composer the run's page already has, opened as a reminder
/// to the contact who approves (a draft; a person presses send).
export type Reminder = { clientId: string; taskId: string; composer: ComposerProps };

const OPEN: TaskStatus[] = ["OPEN", "IN_PROGRESS", "PENDING_APPROVAL"];

export type TemplateChoice = { id: string; name: string; when: string; stepCount: number };

export function TaskSteps({
  taskId,
  clientId,
  steps,
  parentIsClosed,
  templates,
  listQuery = "",
  reminder = null,
}: {
  reminder?: Reminder | null;
  /// The list this task was opened from, handed on to each step so the
  /// way back from a step still leads to that list.
  listQuery?: string;
  taskId: string;
  clientId: string;
  steps: Step[];
  parentIsClosed: boolean;
  templates: TemplateChoice[];
}) {
  const t = useTranslations("tasks.detail.steps");
  const done = steps.filter((s) => !OPEN.includes(s.status)).length;

  return (
    <div className="rounded-2xl border border-app-border bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-medium text-app-text-secondary">{t("title")}</h2>
        {steps.length > 0 && (
          <span className="font-jbmono text-[13px] text-app-text-secondary">
            {done}/{steps.length}
          </span>
        )}
      </div>

      {steps.length === 0 ? (
        <p className="mt-1.5 text-[12.5px] text-app-text-secondary">
          {t("empty")}
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-app-border">
          {steps.map((step, i) => (
            <StepRow key={step.id} step={step} n={i + 1} parentId={taskId} listQuery={listQuery} reminder={reminder} />
          ))}
        </ul>
      )}

      {/* A task that is finished does not grow new steps. The server
          refuses it either way (PARENT_CLOSED_MESSAGE); hiding the field
          means nobody types a sentence only to be told no. */}
      {!parentIsClosed && (
        <>
          <AddStep taskId={taskId} clientId={clientId} />
          <FromTheBook taskId={taskId} templates={templates} />
        </>
      )}
    </div>
  );
}

function StepRow({ step, n, parentId, listQuery, reminder }: { step: Step; n: number; parentId: string; listQuery: string; reminder: Reminder | null }) {
  const t = useTranslations("tasks.detail.steps");
  const format = useFormatter();
  const isDone = !OPEN.includes(step.status);
  const { showToast } = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [recording, setRecording] = useState(false);
  // Stage 3: a client's approval is written down, not ticked.
  const waitsForClient = !!step.clientApprover && !step.clientApproval && !isDone;

  async function toggle() {
    if (pending) return;
    if (waitsForClient) {
      setRecording(true);
      return;
    }
    setPending(true);
    setError(null);
    const result = await setTaskStepDoneAction({ stepId: step.id, parentId, done: !isDone });
    if (!result.ok) setError(result.error);
    else if (result.outcome === "sent") showToast({ tone: "success", title: t("sentForApproval"), description: step.approverName ? t("approverNotified", { name: step.approverName }) : undefined });
    else if (result.outcome === "approved") showToast({ tone: "success", title: t("approved") });
    setPending(false);
  }

  return (
    <li className="flex items-start gap-2.5 py-2.5">
      <input
        type="checkbox"
        checked={isDone}
        disabled={pending}
        onChange={toggle}
        // The step's own title, so a screen reader announcing a column of
        // checkboxes says what each one closes rather than "checkbox,
        // checkbox, checkbox".
        aria-label={t("markDone", { title: step.title })}
        className="mt-[3px] h-4 w-4 shrink-0 cursor-pointer accent-app-text-primary"
      />
      <div className="min-w-0 flex-1">
        <Link
          href={taskHref(step.id, listQuery)}
          dir="auto"
          className={`block text-[13.5px] transition-colors hover:text-app-text-primary ${
            isDone ? "text-app-text-tertiary line-through" : "text-app-text-primary"
          }`}
        >
          {step.title}
        </Link>
        {step.approverName && (
          <p className={`mt-0.5 text-[11.5px] ${step.status === "PENDING_APPROVAL" ? "font-medium text-app-warning" : "text-app-text-tertiary"}`}>
            {step.status === "PENDING_APPROVAL"
              ? t("awaitingApprovalOf", { name: step.approverName })
              : isDone
                ? t("approved")
                : t("requiresApprovalOf", { name: step.approverName })}
          </p>
        )}
        {step.approverName && isDone && step.approvedByName && step.approvedAt && (
          <p className="mt-0.5 text-[11.5px] font-medium text-app-success">{t("approvedByLine", { name: step.approvedByName, date: formatDay(format, step.approvedAt) })}</p>
        )}
        {step.clientApprover && step.clientApproval && (
          <p className="mt-0.5 text-[11.5px] font-medium text-app-success" data-testid="step-client-approved">
            {t("approvedClientLine", { name: step.clientApprover, how: t(`hows.${step.clientApproval.how as ApprovalHow}`), date: formatDay(format, `${step.clientApproval.at}T12:00:00Z`) })}
            {step.clientApproval.link && (
              <a href={step.clientApproval.link} target="_blank" rel="noopener noreferrer" className="ms-1.5 text-app-text-accent hover:underline">
                ↗
              </a>
            )}
          </p>
        )}
        {waitsForClient && (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-[10px] bg-app-warning-soft px-3.5 py-3" data-testid="step-awaiting-client">
            <div className="flex flex-col gap-0.5">
              <p className="text-[14px] font-bold text-app-warning">{t("awaitingClient", { name: step.clientApprover! })}</p>
              <p className="text-[12.5px] text-app-warning">{t("clientNeedsRecord")}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {reminder && <MessageClient clientId={reminder.clientId} taskId={reminder.taskId} {...reminder.composer} buttonLabel={t("remind", { name: step.clientApprover! })} preselectKind="decision_waiting" />}
              <button type="button" onClick={() => setRecording(true)} className="h-[38px] rounded-[9px] bg-app-surface-nav px-3.5 text-[14px] font-bold text-white">
                {t("clientApproved", { name: step.clientApprover! })}
              </button>
            </div>
          </div>
        )}
        {recording && <ClientApprovalDialog step={step} n={n} parentId={parentId} onClose={() => setRecording(false)} />}
        {(step.assignedToName || step.dueDate) && (
          <p className="mt-0.5 text-[11.5px] text-app-text-tertiary">
            {[step.assignedToName, step.dueDate ? formatDay(format, step.dueDate) : null].filter(Boolean).join(" · ")}
          </p>
        )}
        {error && <p className="mt-1 text-[11.5px] text-app-error">{error}</p>}
      </div>
    </li>
  );
}

/// "איך {name} אישר/ה?" (Run.dc.html): when, how, and a link if there is
/// one. Saved, the step is done.
function ClientApprovalDialog({ step, n, parentId, onClose }: { step: Step; n: number; parentId: string; onClose: () => void }) {
  const t = useTranslations("tasks.detail.steps");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
  const [at, setAt] = useState(today);
  const [how, setHow] = useState<string>("EMAIL");
  const [link, setLink] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = "w-full rounded-[9px] border border-app-border bg-white px-3 py-2.5 text-[15px] text-app-text-primary";
  async function save() {
    setPending(true);
    setError(null);
    const r = await recordClientApprovalAction({ stepId: step.id, parentId, at, how, link: link.trim() || null });
    setPending(false);
    if (!r.ok) return setError(r.error);
    onClose();
  }
  return (
    <CenterDialog triggerLabel="" defaultOpen eyebrow={t("dialogEyebrow", { n, title: step.title })} title={t("dialogTitle", { name: step.clientApprover ?? "" })} onDismiss={onClose} hideTrigger size="small">
      <div className="flex flex-col gap-4 px-5 py-6 sm:px-8" data-testid="client-approval-dialog">
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5 text-sm font-bold text-app-text-primary">
            {t("when")}
            <input type="date" value={at} max={today} onChange={(e) => setAt(e.target.value)} className={`${field} font-normal`} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-bold text-app-text-primary">
            {t("how")}
            <select value={how} onChange={(e) => setHow(e.target.value)} className={`${field} font-normal`}>
              {APPROVAL_HOWS.map((h) => (
                <option key={h} value={h}>
                  {t(`hows.${h}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex flex-col gap-1.5 text-sm font-bold text-app-text-primary">
          {t("link")}
          <input type="url" dir="ltr" value={link} onChange={(e) => setLink(e.target.value)} placeholder={t("linkPlaceholder")} className={`${field} font-normal`} />
        </label>
        {error && <p className="text-sm text-app-error">{error}</p>}
        <div className="flex flex-wrap gap-2.5">
          <button type="button" disabled={pending || !at} onClick={save} className="h-[42px] rounded-[10px] bg-app-surface-nav px-5 text-[15px] font-bold text-white disabled:opacity-50">
            {pending ? t("saving") : t("saveApproval")}
          </button>
          <button type="button" onClick={onClose} className="h-[42px] rounded-[10px] border border-app-border-strong bg-white px-4 text-[15px] text-app-text-primary">
            {t("cancel")}
          </button>
        </div>
        <p className="text-[13px] text-app-text-secondary">{t("recordNote")}</p>
      </div>
    </CenterDialog>
  );
}

function AddStep({ taskId, clientId }: { taskId: string; clientId: string }) {
  const t = useTranslations("tasks.detail.steps");
  const [title, setTitle] = useState("");
  const { onSubmit, pending, error } = useActionForm(
    (_prev, data: FormData) =>
      addTaskStepAction({ taskId, clientId, title: String(data.get("title") ?? "") }),
    () => setTitle("")
  );

  return (
    <form onSubmit={onSubmit} className="mt-3 flex items-center gap-2">
      <Plus size={15} className="shrink-0 text-app-text-tertiary" />
      <input
        name="title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        dir="auto"
        aria-label={t("newStep")}
        placeholder={t("placeholder")}
        className="min-w-0 flex-1 border-b border-app-border-strong bg-transparent py-1.5 text-[13.5px] text-app-text-primary outline-none placeholder:text-app-text-tertiary focus:border-app-surface-nav"
      />
      <button
        type="submit"
        disabled={pending || !title.trim()}
        className="shrink-0 rounded-full border border-app-border px-3 py-1.5 text-[12.5px] font-medium text-app-text-primary transition-colors hover:border-gold disabled:opacity-40"
      >
        {pending ? t("adding") : t("add")}
      </button>
      {error && <p className="w-full text-[11.5px] text-app-error">{error}</p>}
    </form>
  );
}

/// In the reader's locale and time zone (ADR 0006).
function formatDay(format: ReturnType<typeof useFormatter>, iso: string) {
  return format.dateTime(new Date(iso), { day: "numeric", month: "short" });
}

/// The procedures from the SOP book, one click away.
///
/// Closed by default and opened by a link rather than sitting open as a
/// row of buttons. Most tasks are not one of these seven situations, and
/// a permanent row of seven names on every task screen would be seven
/// things to read past on the way to the thing somebody came for.
///
/// Each one says WHEN to reach for it, not what is in it. A person
/// choosing between "טעות שהתגלתה" and "משבר" is asking which situation
/// they are in, and the step list will answer the other question a
/// second later.
function FromTheBook({ taskId, templates }: { taskId: string; templates: TemplateChoice[] }) {
  const t = useTranslations("tasks.detail.steps");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function apply(templateId: string) {
    if (busy) return;
    setBusy(templateId);
    setError(null);
    const result = await applyTaskTemplateAction({ taskId, templateId });
    if (!result.ok) setError(result.error);
    else setOpen(false);
    setBusy(null);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 text-[12.5px] text-app-text-accent transition-colors hover:text-app-text-primary"
      >
        {t("fromBook")}
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-app-border bg-cream/40 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[12.5px] font-medium text-app-text-primary">{t("fromBook")}</p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[11.5px] text-app-text-tertiary hover:text-app-text-primary"
        >
          {t("close")}
        </button>
      </div>
      <p className="mt-0.5 text-[11.5px] text-app-text-secondary">
        {t("bookHint")}
      </p>
      <ul className="mt-2 space-y-1">
        {templates.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => apply(t.id)}
              className="w-full rounded-lg px-2 py-1.5 text-start transition-colors hover:bg-white disabled:opacity-40"
            >
              <span className="text-[13px] text-app-text-primary">{t.name}</span>
              <span className="font-jbmono text-[11px] text-app-text-tertiary"> · {t.stepCount}</span>
              <span className="block text-[11.5px] text-app-text-secondary">{t.when}</span>
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="mt-1.5 text-[11.5px] text-app-error">{error}</p>}
    </div>
  );
}
