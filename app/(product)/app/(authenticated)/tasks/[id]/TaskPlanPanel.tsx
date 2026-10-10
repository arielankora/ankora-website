"use client";
import { useState } from "react";
import { renderMarkdownLite } from "@/lib/markdown-lite";
import { useToast } from "@/components/app/toast/ToastProvider";
import { applyPlanStepsAction, approveTaskPlanAction, saveTaskPlanAction } from "./actions";

// "קדם עם קלוד" (10.10.2026): the task's work plan, on the task's screen.
//
// Shown only when a plan exists. Before that, the button above the steps
// is the way to make one, and an empty card saying "no plan yet" on every
// task would be one more thing to read past.
//
// Placed above the steps, because that is the order of thinking: the plan
// says how the work will be done, and the steps are where it is ticked.
// The body is clipped until asked for: a plan is read in full once and
// glanced at every time after, and the glance is what this screen serves.

export type PlanView = {
  version: number;
  status: "DRAFT" | "APPROVED";
  body: string;
  steps: string[];
  origin: "APP" | "MCP";
  changeNote: string | null;
  createdAt: string;
  createdByName: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  stepsAppliedAt: string | null;
};

function day(iso: string) {
  return new Date(iso).toLocaleDateString("he-IL", { day: "numeric", month: "numeric", year: "numeric" });
}

function metaLine(p: PlanView): string {
  const parts = [`גרסה ${p.version}`];
  if (p.status === "APPROVED") {
    parts.push(`אושרה${p.approvedByName ? ` על ידי ${p.approvedByName}` : ""}, ${day(p.approvedAt ?? p.createdAt)}`);
  } else {
    parts.push(`טיוטה${p.createdByName ? ` של ${p.createdByName}` : ""}, ${day(p.createdAt)}`);
  }
  parts.push(p.origin === "MCP" ? "נכתבה עם קלוד" : "נערכה במערכת");
  return parts.join(" · ");
}

export function TaskPlanPanel({
  taskId,
  plan,
  history,
  editable,
  openStepCount,
}: {
  taskId: string;
  plan: PlanView;
  history: PlanView[];
  /// False on a closed task and on a step: the plan is then history.
  editable: boolean;
  /// Existing steps that a copy from the plan would replace.
  openStepCount: number;
}) {
  const { showToast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftBody, setDraftBody] = useState(plan.body);
  const [draftSteps, setDraftSteps] = useState(plan.steps.join("\n"));

  const isLong = plan.body.length > 900 || plan.body.split("\n").length > 14;

  async function approve() {
    setBusy(true);
    setError(null);
    const r = await approveTaskPlanAction({ taskId, version: plan.version });
    setBusy(false);
    if (!r.ok) setError(r.error);
    else showToast({ tone: "success", title: "התוכנית אושרה" });
  }

  async function applySteps() {
    setBusy(true);
    setError(null);
    const r = await applyPlanStepsAction({ taskId });
    setBusy(false);
    setConfirmApply(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    showToast({
      tone: "success",
      title: "השלבים עודכנו לפי התוכנית",
      description: r.kept > 0 ? `${r.kept} שלבים שבוצעו או שדווח עליהם זמן נשארו כמו שהם.` : undefined,
    });
  }

  async function save() {
    setBusy(true);
    setError(null);
    const r = await saveTaskPlanAction({
      taskId,
      body: draftBody,
      steps: draftSteps.split("\n"),
      baseVersion: plan.version,
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setEditing(false);
    showToast({ tone: "success", title: `נשמרה גרסה ${r.version}` });
  }

  return (
    <section className="rounded-2xl border border-lineDark bg-white p-5" data-testid="task-plan">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-medium text-appNavy/70">תוכנית עבודה</h2>
        <span className="text-[12px] text-appNavy/50">{metaLine(plan)}</span>
      </div>
      {plan.changeNote && <p className="mt-1 text-[12px] text-appNavy/55">מה השתנה: {plan.changeNote}</p>}

      {plan.status === "DRAFT" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-cream/50 px-3 py-2">
          <span className="text-[12.5px] text-appNavy/75">התוכנית הזו עדיין טיוטה ולא אושרה.</span>
          {editable && (
            <button
              type="button"
              disabled={busy}
              onClick={approve}
              className="rounded-full bg-gold-gradient px-3 py-1 text-[12px] font-medium text-navy disabled:opacity-40"
            >
              אישור התוכנית
            </button>
          )}
        </div>
      )}

      {editing ? (
        <div className="mt-3 space-y-3">
          <label className="block">
            <span className="text-[12px] text-appNavy/60">התוכנית</span>
            <textarea
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              rows={14}
              dir="rtl"
              className="mt-1 w-full resize-y rounded-lg border border-lineDark p-2 text-[13.5px] leading-relaxed text-appNavy outline-none focus:border-appNavy"
            />
          </label>
          <label className="block">
            <span className="text-[12px] text-appNavy/60">שלבים מוצעים, שורה לכל שלב</span>
            <textarea
              value={draftSteps}
              onChange={(e) => setDraftSteps(e.target.value)}
              rows={6}
              dir="rtl"
              className="mt-1 w-full resize-y rounded-lg border border-lineDark p-2 text-[13.5px] text-appNavy outline-none focus:border-appNavy"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || !draftBody.trim()}
              onClick={save}
              className="rounded-full bg-gold-gradient px-4 py-1.5 text-[13px] font-medium text-navy disabled:opacity-40"
            >
              {busy ? "שומר..." : "שמירה כגרסה חדשה"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDraftBody(plan.body);
                setDraftSteps(plan.steps.join("\n"));
                setError(null);
              }}
              className="rounded-full border border-lineDark px-4 py-1.5 text-[13px] text-appNavy/60"
            >
              ביטול
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="relative">
            <div
              className={`mt-3 space-y-2 text-[14px] leading-relaxed text-appNavy/85 [&_p]:m-0 ${
                isLong && !expanded ? "max-h-72 overflow-hidden" : ""
              }`}
              // Same renderer and the same escaping as the description and
              // the thread. Read lib/markdown-lite.ts's security note before
              // changing either side.
              dangerouslySetInnerHTML={{ __html: renderMarkdownLite(plan.body) }}
            />
            {isLong && !expanded && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-white to-transparent" />
            )}
          </div>
          {isLong && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-2 text-[12.5px] text-gold-dim hover:text-appNavy"
            >
              {expanded ? "צמצום" : "הצגת התוכנית המלאה"}
            </button>
          )}

          {plan.steps.length > 0 && (
            <div className="mt-4 border-t border-lineDark/70 pt-3">
              <p className="text-[12.5px] font-medium text-appNavy/70">שלבים מוצעים ({plan.steps.length})</p>
              <ol className="mt-1.5 list-decimal space-y-0.5 ps-5 text-[13px] text-appNavy/80">
                {plan.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
              {plan.stepsAppliedAt && (
                <p className="mt-1.5 text-[11.5px] text-appNavy/50">הועתקו לשלבים של המשימה ב-{day(plan.stepsAppliedAt)}.</p>
              )}
            </div>
          )}

          {editable && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {plan.status === "APPROVED" && plan.steps.length > 0 && !confirmApply && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => (openStepCount > 0 ? setConfirmApply(true) : applySteps())}
                  className="rounded-full border border-lineDark px-3 py-1.5 text-[12.5px] font-medium text-appNavy transition-colors hover:border-gold disabled:opacity-40"
                >
                  {plan.stepsAppliedAt ? "העתקה מחדש לשלבים" : "הפיכה לשלבים במשימה"}
                </button>
              )}
              {!confirmApply && (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="rounded-full px-3 py-1.5 text-[12.5px] text-appNavy/55 hover:text-appNavy"
                >
                  עריכה
                </button>
              )}
            </div>
          )}

          {confirmApply && (
            <div className="mt-3 rounded-xl border border-lineDark bg-cream/40 p-3">
              <p className="text-[12.5px] text-appNavy/75">
                זה יחליף את {openStepCount} השלבים הקיימים בשלבי התוכנית. שלבים שבוצעו או שדווח עליהם זמן נשארים.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={applySteps}
                  className="rounded-full bg-gold-gradient px-3 py-1 text-[12px] font-medium text-navy disabled:opacity-40"
                >
                  {busy ? "מעדכן..." : "המשך"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmApply(false)}
                  className="rounded-full px-3 py-1 text-[12px] text-appNavy/55 hover:text-appNavy"
                >
                  ביטול
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {error && <p className="mt-2 text-[12px] text-error">{error}</p>}

      {history.length > 0 && (
        <details className="mt-4 border-t border-lineDark/70 pt-3">
          <summary className="cursor-pointer text-[12.5px] text-appNavy/60">גרסאות קודמות ({history.length})</summary>
          <ul className="mt-2 space-y-2">
            {history.map((h) => (
              <li key={h.version}>
                <details className="rounded-lg bg-cream/30 px-3 py-2">
                  <summary className="cursor-pointer text-[12px] text-appNavy/70">
                    {metaLine(h)}
                    {h.changeNote ? ` · ${h.changeNote}` : ""}
                  </summary>
                  <div
                    className="mt-2 space-y-2 text-[13px] leading-relaxed text-appNavy/75 [&_p]:m-0"
                    dangerouslySetInnerHTML={{ __html: renderMarkdownLite(h.body) }}
                  />
                </details>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
