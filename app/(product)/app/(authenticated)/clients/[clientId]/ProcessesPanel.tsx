"use client";
import { useState } from "react";
import { Drawer, useDrawerClose } from "@/components/app/Drawer";
import { useActionForm } from "@/components/app/useActionForm";
import { useToast } from "@/components/app/toast/ToastProvider";
import { StatusBadge } from "@/components/app/StatusBadge";
import { KNOWLEDGE_STATUS_LABELS, type KnowledgeStatusLike } from "@/lib/knowledge";
import {
  ACTION_TAGS,
  ACTION_TAG_LABELS,
  MAX_PROCESS_STEPS,
  STEP_MODE_LABELS,
  TRANSITION_LABELS,
  TRIGGER_LABELS,
  type ActionTag,
  type ProcessStep,
  type StepModeLike,
  type TransitionLike,
  type TriggerLike,
} from "@/lib/process-rules";
import {
  addProcessAction,
  approveProcessVersionAction,
  linkProcessDatesAction,
  removeProcessAction,
  saveProcessVersionAction,
  setProcessStatusAction,
  startProcessRunAction,
  updateProcessAction,
} from "../process-actions";
import Link from "next/link";
import { EntitySelect, Field, INPUT, LABEL, SourceCodes, SourcesField, StatusLine, type EntityOption, type SourceOption } from "./knowledge-ui";

// Org brain, phase 1: processes and their procedures, section 7.4 of the
// client file (claude/org-brain-spec-2026-10-12.md, 3.8, 3.9).
//
// A card per process: what triggers it, who owns it, where it stands in
// the handover, how complete it is (Oren's nine fields) and what is
// missing, and the procedure in force. A new procedure is a draft until a
// manager approves it, and the checks that would block it show on the
// draft before anyone presses the button.

type Option = { id: string; name: string };

export type PanelProcess = {
  id: string;
  code: string;
  title: string;
  purpose: string | null;
  status: "DRAFT" | "ACTIVE" | "PAUSED" | "RETIRED";
  triggerKinds: TriggerLike[];
  triggerText: string | null;
  ownerId: string | null;
  backupOwnerId: string | null;
  slaText: string | null;
  slaBusinessDays: number | null;
  externalPartyContactIds: string[];
  externalPartyText: string | null;
  requiredSystemIds: string[];
  approverText: string | null;
  approvalPolicyIds: string[];
  approvalText: string | null;
  exceptionPlaybook: string | null;
  entityId: string | null;
  executorText: string | null;
  transitionStatus: TransitionLike;
  knowledgeStatus: KnowledgeStatusLike;
  toResolve: string | null;
  sources: string[];
  score: number;
  gaps: string[];
  nextDate: string | null;
  dateIds: string[];
  latestVersion: number;
  current: { version: number; steps: ProcessStep[]; highlights: string | null; outputs: string | null; approvedByName: string | null } | null;
  draft: { version: number; steps: ProcessStep[]; highlights: string | null; outputs: string | null; changeNote: string | null; checks: { code: string; message: string }[] } | null;
  runs: { id: string; title: string; status: string; dueDate: string | null }[];
};

const TONE: Record<TransitionLike, "green" | "amber" | "gray"> = { WITH_ANKORA: "green", IN_HANDOVER: "amber", WITH_CLIENT: "gray", NOT_PLANNED: "gray" };

function day(iso: string) {
  return new Date(iso).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem" });
}

function Checks({ name, options, selected }: { name: string; options: Option[]; selected: string[] }) {
  if (options.length === 0) return <p className="mt-1 text-[11px] text-appNavy/40">אין עדיין בתיק.</p>;
  return (
    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
      {options.map((o) => (
        <label key={o.id} className="flex items-center gap-1.5 text-sm text-appNavy">
          <input type="checkbox" name={name} value={o.id} defaultChecked={selected.includes(o.id)} className="h-4 w-4 accent-gold" />
          {o.name}
        </label>
      ))}
    </div>
  );
}

function ProcessForm({
  clientId,
  existing,
  staff,
  contacts,
  systems,
  rules,
  entities,
  sourceOptions,
}: {
  clientId: string;
  existing?: PanelProcess;
  staff: Option[];
  contacts: Option[];
  systems: Option[];
  rules: Option[];
  entities: EntityOption[];
  sourceOptions: SourceOption[];
}) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(existing ? updateProcessAction : addProcessAction, close);
  const [status, setStatus] = useState<KnowledgeStatusLike>(existing?.knowledgeStatus ?? "CONFIRMED");
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="clientId" value={clientId} />
      {existing && <input type="hidden" name="id" value={existing.id} />}
      <Field label="שם התהליך *">
        <input name="title" required defaultValue={existing?.title ?? ""} placeholder="תשלומי ספקים, LTD" className={INPUT} />
      </Field>
      <Field label="למה הוא קיים">
        <input name="purpose" defaultValue={existing?.purpose ?? ""} className={INPUT} />
      </Field>
      <fieldset>
        <legend className={LABEL}>מה מפעיל אותו</legend>
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
          {(Object.keys(TRIGGER_LABELS) as TriggerLike[]).map((t) => (
            <label key={t} className="flex items-center gap-1.5 text-sm text-appNavy">
              <input type="checkbox" name="triggerKinds" value={t} defaultChecked={existing?.triggerKinds.includes(t)} className="h-4 w-4 accent-gold" />
              {TRIGGER_LABELS[t]}
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="הטריגר במילים">
        <input name="triggerText" defaultValue={existing?.triggerText ?? ""} placeholder="פעמיים בחודש, ב-10 וב-25" className={INPUT} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="בעלים">
          <select name="ownerId" defaultValue={existing?.ownerId ?? ""} className={INPUT}>
            <option value="">לא נקבע</option>
            {staff.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="מחליף">
          <select name="backupOwnerId" defaultValue={existing?.backupOwnerId ?? ""} className={INPUT}>
            <option value="">אין</option>
            {staff.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-[1fr_7rem] gap-3">
        <Field label="SLA">
          <input name="slaText" defaultValue={existing?.slaText ?? ""} placeholder="החומר אצל איילה יומיים עסקים לפני" className={INPUT} />
        </Field>
        <Field label="ימי עסקים">
          <input name="slaBusinessDays" inputMode="numeric" defaultValue={existing?.slaBusinessDays ?? ""} className={INPUT} />
        </Field>
      </div>
      <div>
        <span className={LABEL}>מערכות</span>
        <Checks name="requiredSystemIds" options={systems} selected={existing?.requiredSystemIds ?? []} />
      </div>
      <div>
        <span className={LABEL}>גורם חיצוני</span>
        <Checks name="externalPartyContactIds" options={contacts} selected={existing?.externalPartyContactIds ?? []} />
        <input name="externalPartyText" defaultValue={existing?.externalPartyText ?? ""} placeholder='Nextage, או "אין"' className={INPUT} />
      </div>
      <Field label="מי מאשר">
        <input name="approverText" defaultValue={existing?.approverText ?? ""} placeholder="מורשה חתימה בבנק" className={INPUT} />
      </Field>
      <div>
        <span className={LABEL}>ספי אישור</span>
        <Checks name="approvalPolicyIds" options={rules} selected={existing?.approvalPolicyIds ?? []} />
        <input name="approvalText" defaultValue={existing?.approvalText ?? ""} placeholder='ספק חדש: אישור רו"ח, או "אין"' className={INPUT} />
      </div>
      <Field label="נוהל חריגים">
        <textarea name="exceptionPlaybook" rows={3} defaultValue={existing?.exceptionPlaybook ?? ""} placeholder="מה עושים כשמשהו חורג" className={INPUT} />
      </Field>
      <EntitySelect entities={entities} defaultValue={existing?.entityId} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="מי מבצע היום">
          <input name="executorText" defaultValue={existing?.executorText ?? ""} placeholder="גיא" className={INPUT} />
        </Field>
        <Field label="איפה בחפיפה">
          <select name="transitionStatus" defaultValue={existing?.transitionStatus ?? "WITH_CLIENT"} className={INPUT}>
            {(Object.keys(TRANSITION_LABELS) as TransitionLike[]).map((t) => (
              <option key={t} value={t}>
                {TRANSITION_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="מה ידוע על התהליך">
        <select name="knowledgeStatus" value={status} onChange={(e) => setStatus(e.target.value as KnowledgeStatusLike)} className={INPUT}>
          <option value="CONFIRMED">{KNOWLEDGE_STATUS_LABELS.CONFIRMED}</option>
          <option value="UNCERTAIN">{KNOWLEDGE_STATUS_LABELS.UNCERTAIN}</option>
          <option value="MISSING">{KNOWLEDGE_STATUS_LABELS.MISSING}</option>
        </select>
      </Field>
      <SourcesField options={sourceOptions} defaultValue={existing?.sources.join(", ")} status={status} />
      {status !== "CONFIRMED" && (
        <Field label="מה יסגור את זה *">
          <input name="toResolve" required defaultValue={existing?.toResolve ?? ""} className={INPUT} />
        </Field>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-navy disabled:opacity-50">
        {pending ? "שומר..." : existing ? "שמירה" : "הוספה לתיק"}
      </button>
    </form>
  );
}

const EMPTY_STEP: ProcessStep = { title: "", mode: "MANUAL", offsetBusinessDays: null, actionTags: [], systemIds: [], output: null, verification: null, requiresApproval: false };

function ProcedureEditor({ clientId, process, systems }: { clientId: string; process: PanelProcess; systems: Option[] }) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(saveProcessVersionAction, close);
  const start = process.draft ?? process.current;
  const [steps, setSteps] = useState<ProcessStep[]>(start?.steps.length ? start.steps : [{ ...EMPTY_STEP }]);
  const set = (i: number, patch: Partial<ProcessStep>) => setSteps((all) => all.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: -1 | 1) =>
    setSteps((all) => {
      const next = [...all];
      const j = i + d;
      if (j < 0 || j >= next.length) return all;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="processId" value={process.id} />
      <input type="hidden" name="baseVersion" value={process.latestVersion} />
      <input type="hidden" name="steps" value={JSON.stringify(steps.filter((s) => s.title.trim()))} />
      <p className="text-xs text-appNavy/60">
        נשמר כגרסה {process.latestVersion + 1}, טיוטה. מנהל מאשר, והבדיקות רצות לפני האישור.
      </p>
      <ol className="flex flex-col gap-3">
        {steps.map((st, i) => (
          <li key={i} className="rounded-lg border border-lineDark p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-appNavy/60">שלב {i + 1}</span>
              <span className="flex gap-2 text-xs text-appNavy/50">
                <button type="button" onClick={() => move(i, -1)} aria-label={`הזזת שלב ${i + 1} למעלה`}>
                  ↑
                </button>
                <button type="button" onClick={() => move(i, 1)} aria-label={`הזזת שלב ${i + 1} למטה`}>
                  ↓
                </button>
                <button type="button" onClick={() => setSteps((all) => all.filter((_, j) => j !== i))} className="hover:text-red-600">
                  הסרת שלב
                </button>
              </span>
            </div>
            <input aria-label={`שלב ${i + 1}: מה עושים`} value={st.title} onChange={(e) => set(i, { title: e.target.value })} placeholder="מה עושים" className={INPUT} />
            <div className="mt-2 grid grid-cols-[1fr_7rem] gap-2">
              <select aria-label={`שלב ${i + 1}: איך`} value={st.mode} onChange={(e) => set(i, { mode: e.target.value as StepModeLike })} className={INPUT}>
                {(Object.keys(STEP_MODE_LABELS) as StepModeLike[]).map((m) => (
                  <option key={m} value={m}>
                    {STEP_MODE_LABELS[m]}
                  </option>
                ))}
              </select>
              <input
                aria-label={`שלב ${i + 1}: ימי עסקים מהמועד`}
                inputMode="numeric"
                value={st.offsetBusinessDays ?? ""}
                onChange={(e) => set(i, { offsetBusinessDays: /^-?\d+$/.test(e.target.value) ? Number(e.target.value) : null })}
                placeholder="ימים, -2"
                className={INPUT}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {ACTION_TAGS.map((t) => (
                <label key={t} className="flex items-center gap-1 text-xs text-appNavy/70">
                  <input
                    type="checkbox"
                    checked={st.actionTags.includes(t)}
                    onChange={(e) => set(i, { actionTags: e.target.checked ? [...st.actionTags, t] : st.actionTags.filter((x: ActionTag) => x !== t) })}
                    className="h-3.5 w-3.5 accent-gold"
                  />
                  {ACTION_TAG_LABELS[t]}
                </label>
              ))}
            </div>
            {systems.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                {systems.map((s) => (
                  <label key={s.id} className="flex items-center gap-1 text-xs text-appNavy/70">
                    <input
                      type="checkbox"
                      checked={st.systemIds.includes(s.id)}
                      onChange={(e) => set(i, { systemIds: e.target.checked ? [...st.systemIds, s.id] : st.systemIds.filter((x) => x !== s.id) })}
                      className="h-3.5 w-3.5 accent-gold"
                    />
                    {s.name}
                  </label>
                ))}
              </div>
            )}
            <input value={st.output ?? ""} onChange={(e) => set(i, { output: e.target.value || null })} placeholder="מה נוצר בסוף השלב" className={INPUT} />
            {st.mode === "AUTOMATED" && (
              <input value={st.verification ?? ""} onChange={(e) => set(i, { verification: e.target.value || null })} placeholder="איך אדם מוודא שזה קרה *" className={INPUT} />
            )}
            <label className="mt-2 flex items-center gap-1.5 text-xs text-appNavy">
              <input type="checkbox" checked={st.requiresApproval} onChange={(e) => set(i, { requiresApproval: e.target.checked })} className="h-4 w-4 accent-gold" />
              דורש אישור לפני ביצוע
            </label>
          </li>
        ))}
      </ol>
      {steps.length < MAX_PROCESS_STEPS && (
        <button type="button" onClick={() => setSteps((all) => [...all, { ...EMPTY_STEP }])} className="self-start text-xs text-gold-dim hover:underline">
          + שלב
        </button>
      )}
      <Field label="דגשים">
        <textarea name="highlights" rows={2} defaultValue={start?.highlights ?? ""} placeholder="רישום ותשלום הם שני ערוצים נפרדים" className={INPUT} />
      </Field>
      <Field label="מה חייב להיווצר כדי שהריצה תיחשב גמורה">
        <input name="outputs" defaultValue={start?.outputs ?? ""} className={INPUT} />
      </Field>
      <Field label="מה השתנה ולמה">
        <input name="changeNote" className={INPUT} />
      </Field>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-navy disabled:opacity-50">
        {pending ? "שומר..." : "שמירת טיוטה"}
      </button>
    </form>
  );
}

function DatesForm({ clientId, process, dates }: { clientId: string; process: PanelProcess; dates: Option[] }) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(linkProcessDatesAction, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="processId" value={process.id} />
      <p className="text-xs text-appNavy/60">המועדים של הלקוח שמפעילים את התהליך. ריצה תיפתח מהם כשהנוהל מאושר.</p>
      <Checks name="dateIds" options={dates} selected={process.dateIds} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-navy disabled:opacity-50">
        {pending ? "שומר..." : "שמירה"}
      </button>
    </form>
  );
}

function StartRunForm({ clientId, process }: { clientId: string; process: PanelProcess }) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(startProcessRunAction, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="processId" value={process.id} />
      <p className="text-xs text-appNavy/60">
        נפתחת משימה עם {process.current?.steps.length ?? 0} השלבים של נוהל גרסה {process.current?.version}, כל אחד ביום העסקים שלו.
      </p>
      <Field label="לאיזה יום *">
        <input name="day" type="date" required className={INPUT} />
      </Field>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-navy disabled:opacity-50">
        {pending ? "פותח..." : "פתיחת הריצה"}
      </button>
    </form>
  );
}

function StepList({ steps, systemName }: { steps: ProcessStep[]; systemName: Map<string, string> }) {
  return (
    <ol className="mt-1.5 space-y-1.5">
      {steps.map((st, i) => (
        <li key={i} className="text-xs text-appNavy/80">
          <span className="font-medium">
            {i + 1}. {st.title}
          </span>
          <span className="text-appNavy/50">
            {" · "}
            {STEP_MODE_LABELS[st.mode]}
            {st.offsetBusinessDays !== null && ` · ${st.offsetBusinessDays >= 0 ? `+${st.offsetBusinessDays}` : st.offsetBusinessDays} ימי עסקים`}
            {st.actionTags.length > 0 && ` · ${st.actionTags.map((t) => ACTION_TAG_LABELS[t]).join(", ")}`}
            {st.systemIds.length > 0 && ` · ${st.systemIds.map((id) => systemName.get(id) ?? "מערכת שהוסרה").join(", ")}`}
            {st.requiresApproval && " · דורש אישור"}
          </span>
          {st.verification && <span className="block text-appNavy/50">אימות: {st.verification}</span>}
        </li>
      ))}
    </ol>
  );
}

export function ProcessesPanel({
  clientId,
  processes,
  staff,
  contacts,
  systems,
  rules,
  dates,
  entities,
  sourceOptions,
  canApprove,
}: {
  clientId: string;
  processes: PanelProcess[];
  staff: Option[];
  contacts: Option[];
  systems: Option[];
  rules: Option[];
  dates: Option[];
  entities: EntityOption[];
  sourceOptions: SourceOption[];
  canApprove: boolean;
}) {
  const { showToast } = useToast();
  const staffName = new Map(staff.map((s) => [s.id, s.name]));
  const systemName = new Map(systems.map((s) => [s.id, s.name]));
  const withUs = processes.filter((p) => p.transitionStatus === "WITH_ANKORA").length;
  const handover = processes.filter((p) => p.transitionStatus === "IN_HANDOVER").length;
  const avg = processes.length ? Math.round((processes.reduce((a, p) => a + p.score, 0) / processes.length) * 10) / 10 : 0;

  async function act(fn: () => Promise<{ error?: string }>, ok: string) {
    const r = await fn();
    if (r.error) showToast({ tone: "error", title: "הפעולה נכשלה", description: r.error });
    else showToast({ tone: "success", title: ok });
  }

  const form = { staff, contacts, systems, rules, entities, sourceOptions };
  return (
    <div id="processes" className="rounded-2xl border border-lineDark bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <h2 className="text-sm font-medium text-appNavy">תהליכים ({processes.length})</h2>
        <Drawer triggerLabel="+ תהליך" title="תהליך" variant="link">
          <ProcessForm clientId={clientId} {...form} />
        </Drawer>
      </div>
      {processes.length > 0 && (
        <p className="mt-1 text-[11px] text-appNavy/50">
          {withUs} אצלנו · {handover} בחפיפה · שלמות ממוצעת {avg} מתוך 9
        </p>
      )}
      {processes.length === 0 ? (
        <p className="mt-2 text-sm text-appNavy/50">אין עדיין תהליכים. מה חוזר אצל הלקוח, מי אחראי, מה מפעיל את זה, ואיך עושים את זה.</p>
      ) : (
        <ul className="mt-4 divide-y divide-lineDark">
          {processes.map((p) => (
            <li key={p.id} className="py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-appNavy/50">{p.code}</span>
                    <p className="text-sm font-medium text-appNavy">{p.title}</p>
                    <StatusBadge label={TRANSITION_LABELS[p.transitionStatus]} tone={TONE[p.transitionStatus]} />
                    {p.status !== "ACTIVE" && (
                      <StatusBadge label={p.status === "DRAFT" ? "אין נוהל מאושר" : p.status === "PAUSED" ? "מושהה" : "בוטל"} tone="gray" />
                    )}
                    <span className={`text-xs ${p.score >= 8 ? "text-emerald-700" : "text-warning"}`}>{p.score} מתוך 9</span>
                  </div>
                  <p className="mt-1 text-xs text-appNavy/60">
                    {[
                      p.triggerKinds.map((t) => TRIGGER_LABELS[t]).join(", ") || null,
                      p.triggerText,
                      p.ownerId ? `בעלים: ${staffName.get(p.ownerId) ?? ""}` : null,
                      p.backupOwnerId ? `מחליף: ${staffName.get(p.backupOwnerId) ?? ""}` : null,
                      p.executorText ? `מבצע היום: ${p.executorText}` : null,
                      p.nextDate ? `הבא: ${day(p.nextDate)}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {p.gaps.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5">
                      {p.gaps.map((g) => (
                        <li key={g} className="text-xs text-warning">
                          {g}
                        </li>
                      ))}
                    </ul>
                  )}
                  <StatusLine status={p.knowledgeStatus} toResolve={p.toResolve} />
                  <SourceCodes sources={p.sources} options={sourceOptions} />

                  {p.current ? (
                    <div className="mt-2">
                      <p className="text-xs font-medium text-appNavy/70">
                        נוהל, גרסה {p.current.version}
                        {p.current.approvedByName && `, אושר על ידי ${p.current.approvedByName}`}
                      </p>
                      <StepList steps={p.current.steps} systemName={systemName} />
                      {p.current.highlights && <p className="mt-1 text-xs text-appNavy/60">דגשים: {p.current.highlights}</p>}
                    </div>
                  ) : (
                    !p.draft && <p className="mt-2 text-xs text-appNavy/50">עוד אין נוהל.</p>
                  )}

                  {p.runs.length > 0 && (
                    <p className="mt-1.5 text-xs text-appNavy/60">
                      ריצות:{" "}
                      {p.runs.map((r, i) => (
                        <span key={r.id}>
                          {i > 0 && " · "}
                          <Link href={`/app/tasks/${r.id}`} className="text-gold-dim hover:underline">
                            {r.dueDate ? day(r.dueDate) : r.title}
                          </Link>
                          {r.status === "DONE" && " (בוצע)"}
                        </span>
                      ))}
                    </p>
                  )}

                  {p.draft && (
                    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2">
                      <p className="text-xs font-medium text-amber-900">
                        טיוטה, גרסה {p.draft.version}
                        {p.draft.changeNote && `: ${p.draft.changeNote}`}
                      </p>
                      <StepList steps={p.draft.steps} systemName={systemName} />
                      {p.draft.checks.map((c, i) => (
                        <p key={i} className="mt-1 text-xs text-red-700">
                          {c.message}
                        </p>
                      ))}
                      {canApprove && p.draft.checks.length === 0 && (
                        <button
                          type="button"
                          onClick={() => act(() => approveProcessVersionAction(p.id, p.draft!.version, clientId), "הנוהל אושר")}
                          className="mt-1.5 text-xs font-medium text-gold-dim hover:underline"
                        >
                          אישור הנוהל
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2 text-xs">
                  <Drawer triggerLabel="עריכה" title={`עריכה: ${p.code} ${p.title}`} variant="link">
                    <ProcessForm clientId={clientId} existing={p} {...form} />
                  </Drawer>
                  <Drawer triggerLabel={p.draft ? "עריכת הטיוטה" : p.current ? "גרסה חדשה לנוהל" : "כתיבת נוהל"} title={`נוהל: ${p.code} ${p.title}`} variant="link">
                    <ProcedureEditor clientId={clientId} process={p} systems={systems} />
                  </Drawer>
                  {p.status === "ACTIVE" && p.triggerKinds.some((t) => t !== "CONTINUOUS") && (
                    <Drawer triggerLabel="פתיחת ריצה" title={`ריצה: ${p.code} ${p.title}`} variant="link">
                      <StartRunForm clientId={clientId} process={p} />
                    </Drawer>
                  )}
                  {p.triggerKinds.includes("SCHEDULED") && (
                    <Drawer triggerLabel="מועדים" title={`מועדים: ${p.code} ${p.title}`} variant="link">
                      <DatesForm clientId={clientId} process={p} dates={dates} />
                    </Drawer>
                  )}
                  {canApprove && p.status === "ACTIVE" && (
                    <button type="button" onClick={() => act(() => setProcessStatusAction(p.id, "PAUSED", clientId), "התהליך הושהה")} className="text-appNavy/50 hover:text-appNavy">
                      השהיה
                    </button>
                  )}
                  {canApprove && p.status === "PAUSED" && (
                    <button type="button" onClick={() => act(() => setProcessStatusAction(p.id, "ACTIVE", clientId), "התהליך חודש")} className="text-appNavy/50 hover:text-appNavy">
                      חידוש
                    </button>
                  )}
                  {p.status === "DRAFT" && (
                    <button type="button" onClick={() => act(() => removeProcessAction(p.id, clientId), "התהליך הוסר")} className="text-appNavy/50 hover:text-red-600">
                      הסרה
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
