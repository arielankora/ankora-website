"use client";

// The one steps editor (14.11.2026, processes redesign, stage 3), built to
// the "מסך 4: עורך השלבים" board (ops-runbooks/processes-redesign-design/
// Steps.dc.html in claude-backup). A numbered list by default, with a side
// panel for the step chosen; "+ תנאי" turns the list into a flow, where an
// action node opens the same panel. "שמירת טיוטה" saves a draft, and
// "שמירה ואישור" also approves it, for whoever approves the client's
// procedures (Ariel, 14.11.2026). Built only from what the board and the
// spec say; the kind of action sits under "איך" (Ariel, 14.11.2026).

import { useMemo, useState, useTransition, type DragEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ACTION_TAGS, blockingChecks, CHANNELS, MAX_PROCESS_STEPS, type ActionTag, type Channel, type ProcessStep, type StepModeLike } from "@/lib/process-rules";
import { flowFromSteps, flowIssues, flowOrder, flowSteps, type FlowNode, type ProcessFlow } from "@/lib/process-flow";
import type { StepsEditorData } from "@/lib/app-domain/processes";
import { checkText } from "../../../ProcessesPanel";
import { blankNode, FlowEditor, issueText } from "../flow/FlowEditor";
import { autoPositions, newId } from "../flow/flow-layout";
import { saveStepsAction } from "../../../../process-actions";

type Tx = (key: string, values?: Record<string, string | number>) => string;
type Owner = NonNullable<ProcessStep["owner"]>;

const MODES: StepModeLike[] = ["MANUAL", "ASSISTED", "AUTOMATED"];
const INPUT = "w-full rounded-[9px] border border-app-border bg-white px-3 py-2.5 text-[15px] text-app-text-primary";
const LABEL = "flex flex-col gap-1.5 text-sm font-bold text-app-text-primary";
const EMPTY: ProcessStep = { title: "", mode: "MANUAL", offsetBusinessDays: null, actionTags: [], systemIds: [], output: null, verification: null, requiresApproval: false, amountMaxMinor: null, currency: null, channel: null };

/// A flow the list can hold: actions one after another, nothing else.
function isLinear(flow: ProcessFlow): boolean {
  return flow.nodes.every((n) => n.kind === "END" || (n.kind === "ACTION" && !n.send));
}

function withPositions(flow: ProcessFlow): ProcessFlow {
  const pos = autoPositions(flow);
  return { ...flow, nodes: flow.nodes.map((n) => ({ ...n, position: n.position ?? pos.get(n.id) ?? { x: 0, y: 0 } })) };
}

export function StepsEditor({ data }: { data: StepsEditorData }) {
  const t = useTranslations("clients.processes.stepsEditor") as unknown as Tx;
  const tp = useTranslations("clients.processes") as unknown as Tx;
  const router = useRouter();
  const [view, setView] = useState<"list" | "flow">(data.isFlow ? "flow" : "list");
  const [steps, setSteps] = useState<ProcessStep[]>(data.steps);
  const [flow, setFlow] = useState<ProcessFlow>(() => withPositions(data.flow));
  const [picked, setPicked] = useState<number | null>(data.steps.length ? 0 : null);
  const [node, setNode] = useState<string | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [more, setMore] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "wait" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [base, setBase] = useState(data.latestVersion);

  const staffName = useMemo(() => new Map(data.staff.map((u) => [u.id, u.name])), [data.staff]);
  const personName = useMemo(() => new Map(data.people.map((c) => [c.id, c.name])), [data.people]);
  const current = view === "list" ? steps : flowSteps(flow);
  const live = blockingChecks({ steps: current.filter((s) => s.title.trim()) }, []);
  const issues = [
    ...live.map((c) => ({ text: checkText(tp, c), step: c.step })),
    ...data.ruled.map((c) => ({ text: c.message, step: c.step })),
    ...(view === "flow" ? flowIssues(flow).map((i) => ({ text: issueText(tp, i), step: undefined as number | undefined })) : []),
  ];

  const doer = (st: ProcessStep) =>
    st.owner?.userId ? staffName.get(st.owner.userId) ?? "" : st.owner?.contactId ? personName.get(st.owner.contactId) ?? "" : st.owner?.text || data.executor || "";
  const gate = (st: ProcessStep) =>
    st.approverUserId
      ? t("gateAnkora", { name: staffName.get(st.approverUserId) ?? "" })
      : st.approverContactId
        ? t("gateClient", { name: (personName.get(st.approverContactId) ?? "").split(",")[0] })
        : null;

  // A change to the step being edited, in the view it is in.
  const patchStep = (i: number, patch: Partial<ProcessStep>) => {
    setSteps((all) => all.map((s, j) => (j === i ? { ...s, ...patch } : s)));
    setMessage(null);
  };
  const patchNode = (id: string, patch: Partial<ProcessStep>) => {
    setFlow((f) => ({ ...f, nodes: f.nodes.map((n) => (n.id === id && n.step ? { ...n, title: patch.title ?? n.title, owner: patch.owner !== undefined ? patch.owner : n.owner, step: { ...n.step, ...patch } } : n)) }));
    setMessage(null);
  };

  const addStep = () => {
    if (steps.length >= MAX_PROCESS_STEPS) return;
    setSteps((all) => [...all, { ...EMPTY }]);
    setPicked(steps.length);
  };
  const removeStep = (i: number) => {
    setSteps((all) => all.filter((_, j) => j !== i));
    setPicked(null);
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= steps.length || from === to) return;
    setSteps((all) => {
      const next = [...all];
      const [it] = next.splice(from, 1);
      next.splice(to, 0, it);
      return next;
    });
    setPicked(to);
  };

  // "+ תנאי": the list becomes a flow, and a condition comes after the step
  // chosen (or the last one).
  const addCondition = () => {
    const base = withPositions(flowFromSteps(steps.filter((s) => s.title.trim())));
    const after = base.nodes.filter((n) => n.kind === "ACTION")[picked ?? steps.length - 1] ?? null;
    const id = newId("n", base.nodes.map((n) => n.id));
    const cond = blankNode(tp, id, "CONDITION");
    cond.position = after?.position ? { x: after.position.x, y: after.position.y + 150 } : { x: 0, y: base.nodes.length * 150 };
    cond.branches = cond.branches.map((b) => ({ ...b, next: after?.next ?? null }));
    const nodes = base.nodes.map((n) => (after && n.id === after.id ? { ...n, next: id } : n));
    setFlow({ ...base, start: base.start ?? id, nodes: [...nodes, cond] });
    setNode(id);
    setView("flow");
    setMessage(null);
  };
  const toList = () => {
    if (!isLinear(flow)) {
      setMessage({ tone: "error", text: t("listNeedsNoCondition") });
      return;
    }
    setSteps(flowSteps(flow));
    setPicked(null);
    setView("list");
  };
  const toFlow = () => {
    setFlow(withPositions(flowFromSteps(steps.filter((s) => s.title.trim()))));
    setNode(null);
    setView("flow");
  };

  const save = (approve: boolean) => {
    setMessage(null);
    start(async () => {
      const clean = (s: ProcessStep) => ({ ...s, title: s.title.trim() });
      const res = await saveStepsAction({
        clientId: data.clientId,
        processId: data.processId,
        baseVersion: base,
        approve,
        highlights: data.highlights,
        outputs: data.outputs,
        ...(view === "list" ? { steps: steps.filter((s) => s.title.trim()).map(clean) } : { flow }),
      });
      if (res.error) return setMessage({ tone: "error", text: res.error });
      if (res.version) setBase(res.version);
      // Saved and nothing to say: back to the process, where the draft
      // waits or the new version runs. Held back: why, here.
      if (res.reason) return setMessage({ tone: "wait", text: t("savedWaiting", { version: res.version ?? "", reason: res.reason }) });
      setMessage({ tone: "ok", text: res.live ? t("savedLive", { version: res.version ?? "" }) : t("savedDraft", { version: res.version ?? "" }) });
      router.push(`/app/clients/${data.clientId}/processes/${data.processId}`);
    });
  };

  const onDragStart = (i: number) => (e: DragEvent) => {
    setDragging(i);
    e.dataTransfer.effectAllowed = "move";
  };
  const onDrop = (i: number) => (e: DragEvent) => {
    e.preventDefault();
    if (dragging !== null) move(dragging, i);
    setDragging(null);
  };
  const onHandleKey = (i: number) => (e: KeyboardEvent) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      move(i, i - 1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      move(i, i + 1);
    }
  };

  const processHref = `/app/clients/${data.clientId}/processes/${data.processId}`;
  const draftNumber = base + 1;
  const chip = (on: boolean) => `rounded-full px-3.5 py-2 text-sm ${on ? "bg-app-surface-nav font-bold text-white" : "border border-app-border bg-white text-app-text-primary"}`;

  // The side panel for a step: the list's chosen step, or a flow's action.
  const panel = (n: number, st: ProcessStep, set: (patch: Partial<ProcessStep>) => void, remove: () => void) => {
    const ownerValue = st.owner?.userId ? `u:${st.owner.userId}` : st.owner?.contactId ? `c:${st.owner.contactId}` : "";
    const approverValue = st.approverUserId ? `u:${st.approverUserId}` : st.approverContactId ? `c:${st.approverContactId}` : "";
    const evidenceMissing = st.mode === "AUTOMATED" && !st.evidence && !st.verification;
    const setEvidence = (v: string) => set({ evidence: v || null, ...(st.mode === "AUTOMATED" ? { verification: v || null } : {}) });
    return (
      <div className="flex flex-col gap-4" data-testid="step-panel">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-extrabold text-app-text-primary">{t("panelTitle", { n })}</h2>
          <button type="button" onClick={remove} className="text-sm text-app-error hover:underline">
            {t("removeStep")}
          </button>
        </div>
        <label className={LABEL}>
          {t("what")}
          <input aria-label={t("whatAria", { n })} dir="auto" value={st.title} onChange={(e) => set({ title: e.target.value })} className={`${INPUT} font-normal`} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className={LABEL}>
            {t("who")}
            <select
              aria-label={t("whoAria", { n })}
              value={ownerValue}
              onChange={(e) => {
                const v = e.target.value;
                const owner: Owner | null = v.startsWith("u:") ? { userId: v.slice(2), contactId: null, text: null } : v.startsWith("c:") ? { userId: null, contactId: v.slice(2), text: null } : null;
                set({ owner });
              }}
              className={`${INPUT} font-normal`}
            >
              <option value="">{data.executor ? t("whoExecutor", { name: data.executor }) : t("whoExecutorNone")}</option>
              <optgroup label={t("groupStaff")}>
                {data.staff.map((u) => (
                  <option key={u.id} value={`u:${u.id}`}>
                    {u.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label={t("groupClient")}>
                {data.people.map((c) => (
                  <option key={c.id} value={`c:${c.id}`}>
                    {c.ended ? t("left", { name: c.name }) : c.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <label className={LABEL}>
            {t("day")}
            <input
              aria-label={t("dayAria", { n })}
              inputMode="numeric"
              value={st.offsetBusinessDays ?? ""}
              onChange={(e) => set({ offsetBusinessDays: /^-?\d{1,2}$/.test(e.target.value) ? Number(e.target.value) : null })}
              placeholder={t("dayPlaceholder")}
              className={`${INPUT} font-normal`}
            />
          </label>
        </div>
        <div className={LABEL} role="radiogroup" aria-label={t("howAria", { n })}>
          {t("how")}
          <div className="flex flex-wrap gap-2 font-normal">
            {MODES.map((m) => (
              <button key={m} type="button" role="radio" aria-checked={st.mode === m} onClick={() => set({ mode: m, ...(m === "AUTOMATED" && st.evidence && !st.verification ? { verification: st.evidence } : {}) })} className={chip(st.mode === m)}>
                {tp(`labels.stepModes.${m}`)}
              </button>
            ))}
          </div>
        </div>
        <div className={LABEL} role="group" aria-label={t("tags")}>
          {t("tags")}
          <div className="flex flex-wrap gap-1.5 font-normal">
            {ACTION_TAGS.map((tag) => {
              const on = st.actionTags.includes(tag);
              return (
                <button key={tag} type="button" aria-pressed={on} onClick={() => set({ actionTags: on ? st.actionTags.filter((x: ActionTag) => x !== tag) : [...st.actionTags, tag] })} className={`rounded-full px-2.5 py-1 text-[13px] ${on ? "bg-app-surface-nav font-bold text-white" : "border border-app-border bg-white text-app-text-primary"}`}>
                  {tp(`labels.actionTags.${tag}`)}
                </button>
              );
            })}
          </div>
        </div>
        <div className={LABEL} role="group" aria-label={t("systems")}>
          {t("systems")}
          {data.systems.length ? (
            <div className="flex flex-wrap gap-1.5 font-normal">
              {data.systems.map((s) => {
                const on = st.systemIds.includes(s.id);
                return (
                  <button key={s.id} type="button" aria-pressed={on} onClick={() => set({ systemIds: on ? st.systemIds.filter((x) => x !== s.id) : [...st.systemIds, s.id] })} className={`rounded-full px-2.5 py-1 text-[13px] ${on ? "bg-app-surface-nav font-bold text-white" : "border border-app-border bg-white text-app-text-primary"}`}>
                    {s.name}
                  </button>
                );
              })}
            </div>
          ) : (
            <span className="text-sm font-normal text-app-text-secondary">{t("noSystems")}</span>
          )}
        </div>
        <div className="flex flex-col gap-2.5 rounded-xl bg-app-warning-soft px-4 py-3.5">
          <label className="flex flex-col gap-1.5 text-sm font-bold text-app-warning">
            {t("approver")}
            <select
              aria-label={t("approverAria", { n })}
              value={approverValue}
              onChange={(e) => {
                const v = e.target.value;
                set({
                  approverUserId: v.startsWith("u:") ? v.slice(2) : null,
                  approverContactId: v.startsWith("c:") ? v.slice(2) : null,
                  requiresApproval: !!v,
                });
              }}
              className={`${INPUT} font-normal`}
            >
              <option value="">{t("noApprover")}</option>
              <optgroup label={t("groupStaff")}>
                {data.staff.map((u) => (
                  <option key={u.id} value={`u:${u.id}`}>
                    {u.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label={t("groupClient")}>
                {data.people.map((c) => (
                  <option key={c.id} value={`c:${c.id}`} disabled={c.ended && approverValue !== `c:${c.id}`}>
                    {c.ended ? t("left", { name: c.name }) : c.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          {st.approverContactId && <p className="text-sm leading-relaxed text-app-warning">{t("approverClientNote")}</p>}
          {st.approverUserId && <p className="text-sm leading-relaxed text-app-warning">{t("approverAnkoraNote")}</p>}
        </div>
        <label className={LABEL}>
          {t("evidence")}
          <input
            aria-label={t("evidenceAria", { n })}
            aria-invalid={evidenceMissing}
            value={st.evidence ?? st.verification ?? ""}
            onChange={(e) => setEvidence(e.target.value)}
            placeholder={t("evidencePlaceholder")}
            className={`${INPUT} font-normal ${evidenceMissing ? "!border-app-error" : ""}`}
          />
          {evidenceMissing && <span className="text-[13px] font-normal text-app-error">{t("evidenceRequired")}</span>}
        </label>
        {more || st.amountMaxMinor !== null || st.channel ? (
          <div className="grid grid-cols-[1fr_6rem] gap-3">
            <label className={LABEL}>
              {t("amount")}
              <input
                aria-label={t("amountAria", { n })}
                inputMode="decimal"
                value={st.amountMaxMinor === null ? "" : String(st.amountMaxMinor / 100)}
                onChange={(e) => {
                  const v = Number(e.target.value.replace(/,/g, ""));
                  set({ amountMaxMinor: e.target.value.trim() && Number.isFinite(v) && v >= 0 ? Math.round(v * 100) : null });
                }}
                className={`${INPUT} font-normal`}
              />
            </label>
            <label className={LABEL}>
              {t("currency")}
              <select aria-label={t("currencyAria", { n })} value={st.currency ?? ""} onChange={(e) => set({ currency: e.target.value || null })} className={`${INPUT} font-normal`}>
                <option value="" />
                {["ILS", "USD", "EUR"].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className={`${LABEL} col-span-2`}>
              {t("channel")}
              <select aria-label={t("channelAria", { n })} value={st.channel ?? ""} onChange={(e) => set({ channel: (e.target.value || null) as Channel | null })} className={`${INPUT} font-normal`}>
                <option value="">{t("channelNone")}</option>
                {CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {tp(`labels.channels.${c}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : (
          <button type="button" onClick={() => setMore(true)} className="self-start text-sm font-bold text-app-text-accent hover:underline">
            {t("moneyAndChannel")}
          </button>
        )}
      </div>
    );
  };

  const flowPanel = (n: FlowNode) => {
    const i = (flowOrder(flow) ?? flow.nodes).filter((x) => x.kind === "ACTION" && x.step).findIndex((x) => x.id === n.id);
    const st: ProcessStep = { ...(n.step as ProcessStep), title: n.title, owner: n.owner ?? undefined };
    return panel(i >= 0 ? i + 1 : 1, st, (patch) => patchNode(n.id, patch), () => {
      setFlow((f) => {
        const gone = f.nodes.find((x) => x.id === n.id);
        const onward = gone?.next ?? null;
        const fix = (x: string | null) => (x === n.id ? onward : x);
        return {
          ...f,
          start: f.start === n.id ? onward : f.start,
          nodes: f.nodes.filter((x) => x.id !== n.id).map((x) => ({ ...x, next: fix(x.next), elseNext: fix(x.elseNext), branches: x.branches.map((b) => ({ ...b, next: fix(b.next) })) })),
        };
      });
      setNode(null);
    });
  };

  return (
    <div className="flex flex-col" data-testid="steps-editor">
      <nav className="flex flex-wrap items-center gap-2 text-sm text-app-text-secondary" aria-label={tp("page.breadcrumb")}>
        <Link href={`/app/clients/${data.clientId}?tab=file`} className="hover:underline">
          {data.clientName}
        </Link>
        <span aria-hidden="true">/</span>
        <Link href={`/app/clients/${data.clientId}?tab=file&section=processes`} className="hover:underline">
          {tp("page.processes")}
        </Link>
        <span aria-hidden="true">/</span>
        <Link href={processHref} className="hover:underline">
          {data.code}
        </Link>
        <span aria-hidden="true">/</span>
        <span className="font-bold text-app-text-primary">{t("crumbSteps")}</span>
      </nav>

      <header className="mt-4 flex flex-wrap items-center justify-between gap-6 rounded-[14px] border border-app-border bg-white px-5 py-5 sm:px-8">
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-lg font-bold text-app-text-accent">{data.code}</span>
            <h1 className="text-[24px] font-extrabold text-app-text-primary sm:text-[28px]">{t("title", { title: data.title })}</h1>
            <span className="rounded-full bg-app-info-soft px-3 py-1 text-sm font-bold text-app-info">{t("draftPill", { version: draftNumber })}</span>
          </div>
          {data.runningVersion && <p className="text-[15px] text-app-text-secondary">{t("keepsRunning", { version: data.runningVersion })}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <div role="group" aria-label={t("viewLabel")} className="flex overflow-hidden rounded-[10px] border border-app-border">
            <button type="button" aria-pressed={view === "list"} onClick={() => view !== "list" && toList()} className={`px-4 py-2.5 text-sm ${view === "list" ? "bg-app-surface-nav font-bold text-white" : "bg-white text-app-text-secondary"}`}>
              {t("viewList")}
            </button>
            <button type="button" aria-pressed={view === "flow"} onClick={() => view !== "flow" && toFlow()} className={`px-4 py-2.5 text-sm ${view === "flow" ? "bg-app-surface-nav font-bold text-white" : "bg-white text-app-text-secondary"}`}>
              {t("viewFlow")}
            </button>
          </div>
          <Link href={processHref} className="inline-flex h-11 items-center rounded-[10px] border border-app-border-strong bg-white px-[18px] text-[15px] text-app-text-primary">
            {t("cancel")}
          </Link>
          {data.mayApprove && (
            <button type="button" disabled={pending || issues.length > 0} onClick={() => save(true)} className="h-11 rounded-[10px] border border-app-surface-nav bg-white px-[18px] text-[15px] font-bold text-app-text-primary disabled:opacity-50" data-testid="steps-save-approve">
              {pending ? t("saving") : t("saveApprove")}
            </button>
          )}
          <button type="button" disabled={pending} onClick={() => save(false)} className="h-11 rounded-[10px] bg-app-surface-nav px-5 text-[15px] font-bold text-white disabled:opacity-50" data-testid="steps-save">
            {pending ? t("saving") : t("saveDraft")}
          </button>
        </div>
      </header>

      {message && (
        <p role="status" data-testid="steps-message" className={`mt-4 rounded-[10px] px-4 py-2.5 text-sm font-bold ${message.tone === "ok" ? "bg-app-success-soft text-app-success" : message.tone === "wait" ? "bg-app-warning-soft text-app-warning" : "bg-app-error-soft text-app-error"}`}>
          {message.text}
        </p>
      )}

      <div className="mt-7">
        {issues.length === 0 ? (
          <p className="rounded-[10px] bg-app-success-soft px-4 py-2.5 text-sm font-bold text-app-success" data-testid="steps-passed">
            {t("allPassed")}
          </p>
        ) : (
          <div className="rounded-[10px] bg-app-error-soft px-4 py-2.5" data-testid="procedure-issues">
            <p className="text-sm font-bold text-app-error">{t("blocking", { count: issues.length })}</p>
            <ul className="mt-1 flex flex-col gap-0.5">
              {issues.map((c, k) => (
                <li key={k} className="text-sm text-app-error">
                  {c.step ? (
                    <button type="button" onClick={() => view === "list" && setPicked(c.step! - 1)} className="text-start hover:underline">
                      {c.text}
                    </button>
                  ) : (
                    c.text
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {view === "flow" ? (
        <div className="mt-4">
          <FlowEditor clientId={data.clientId} flow={flow} setFlow={setFlow} selected={node} setSelected={setNode} stepPanel={flowPanel} contacts={data.contacts} connections={data.connections} />
        </div>
      ) : steps.length === 0 ? (
        <section className="mt-4 flex max-w-xl flex-col items-start gap-3.5 rounded-[14px] border border-app-border bg-white px-6 py-7" data-testid="steps-empty">
          <h2 className="text-[17px] font-bold text-app-text-primary">{t("emptyTitle")}</h2>
          <p className="text-[15px] leading-relaxed text-app-text-secondary">{t("emptyText")}</p>
          <div className="flex flex-wrap gap-2.5">
            <button type="button" onClick={addStep} className="h-[42px] rounded-[10px] border border-dashed border-app-border-strong bg-white px-4 text-[15px] text-app-text-primary">
              {t("addStep")}
            </button>
          </div>
        </section>
      ) : (
        <div className="mt-4 grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_460px]">
          <div className="flex flex-col gap-3">
            <ol className="flex flex-col gap-3" data-testid="steps-list">
              {steps.map((st, i) => {
                const on = picked === i;
                const g = gate(st);
                const flagged = issues.some((c) => c.step === i + 1);
                return (
                  <li
                    key={i}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={onDrop(i)}
                    onClick={() => setPicked(i)}
                    className={`flex cursor-pointer items-center gap-3.5 rounded-xl bg-white px-[18px] py-3.5 ${on ? "border-2 border-app-accent shadow-[0_2px_10px_rgba(27,42,61,0.08)]" : flagged ? "border border-app-error" : "border border-app-border"}`}
                    data-testid="step-card"
                  >
                    <button
                      type="button"
                      draggable
                      onDragStart={onDragStart(i)}
                      onKeyDown={onHandleKey(i)}
                      aria-label={t("moveHandle", { n: i + 1 })}
                      className="cursor-grab text-lg leading-none text-app-text-tertiary"
                    >
                      ⠿
                    </button>
                    <span className={`flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full text-[15px] font-extrabold text-white ${st.approverContactId ? "bg-app-accent" : "bg-app-surface-nav"}`}>{i + 1}</span>
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <div className="flex justify-between gap-3">
                        <span className="text-base font-bold text-app-text-primary">{st.title || "…"}</span>
                        {st.offsetBusinessDays !== null && <span className="flex-none text-sm text-app-text-secondary">{t("dayN", { n: st.offsetBusinessDays })}</span>}
                      </div>
                      <div className="flex flex-wrap gap-2 text-[13px]">
                        {doer(st) && <span className="rounded-md bg-app-neutral-soft px-2 py-0.5">{doer(st)}</span>}
                        <span className="rounded-md bg-app-neutral-soft px-2 py-0.5">{tp(`labels.stepModes.${st.mode}`)}</span>
                        {g && <span className="rounded-md bg-app-warning-soft px-2 py-0.5 font-bold text-app-warning">{g}</span>}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
            <div className="mt-1 flex flex-wrap items-center gap-2.5">
              <button type="button" onClick={addStep} disabled={steps.length >= MAX_PROCESS_STEPS} className="h-[42px] rounded-[10px] border border-dashed border-app-border-strong bg-white px-4 text-[15px] font-bold text-app-text-primary disabled:opacity-50">
                {t("addStep")}
              </button>
              <button type="button" onClick={addCondition} className="h-[42px] rounded-[10px] border border-dashed border-app-border-strong bg-white px-4 text-[15px] text-app-text-primary">
                {t("addCondition")}
              </button>
              <span className="text-sm text-app-text-secondary">{t("conditionHint")}</span>
            </div>
          </div>
          <aside className="rounded-[14px] border border-app-border bg-white px-6 py-5">
            {picked !== null && steps[picked] ? panel(picked + 1, steps[picked], (patch) => patchStep(picked, patch), () => removeStep(picked)) : <p className="text-sm text-app-text-secondary">{t("pickStep")}</p>}
          </aside>
        </div>
      )}
    </div>
  );
}
