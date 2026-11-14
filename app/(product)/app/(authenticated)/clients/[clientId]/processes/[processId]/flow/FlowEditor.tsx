"use client";

import { useCallback, useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Background, Controls, Handle, MiniMap, Position, ReactFlow, type Connection, type Edge, type Node, type NodeChange, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  BRANCH_SOURCE_LABELS,
  MESSAGE_PARAMS,
  flowIssues,
  flowTree,
  secondEyeNodes,
  type BranchSource,
  type FlowBranch,
  type FlowIssue,
  type FlowNode,
  type FlowNodeKind,
  type ProcessFlow,
} from "@/lib/process-flow";
import { STEP_MODE_LABELS, type ProcessStep, type StepModeLike } from "@/lib/process-rules";
import { intlTag } from "@/lib/i18n/config";
import { newId, NODE_W } from "./flow-layout";

// The procedure flow editor (task cmvtivumj000pjs08q9qj4t67, design
// https://claude.ai/artifact/CjzpzkxiB8xRvpaZNBWkAr, Ariel 4.11.2026): a
// free canvas on a computer (React Flow), a vertical tree on a phone, one
// flow under both. "שמור והפעל" puts it live, unless it needs a second
// pair of eyes.

/// 14.11.2026 (processes redesign, stage 3, "Steps.dc.html"): the flow
/// view of the one steps editor (StepsEditor). It owns no state of its
/// own: the editor holds the flow and the selection, and an action's side
/// panel is the editor's step panel, the same one the list view uses.
type Props = {
  clientId: string;
  flow: ProcessFlow;
  setFlow: Dispatch<SetStateAction<ProcessFlow>>;
  selected: string | null;
  setSelected: (id: string | null) => void;
  /// The step panel for an action node (not a send-mail one).
  stepPanel: (node: FlowNode) => ReactNode;
  contacts: { id: string; name: string }[];
  connections: { id: string; kind: "GOOGLE_OAUTH" | "MAIL_APP_PASSWORD" | "MANAGER_SEND"; account: string }[];
};

const INPUT = "w-full rounded-[10px] border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary";

/// ADR 0006: the editor's words come from `clients.processes`; labels are
/// looked up by their enum value, so through this loose signature.
type Tx = (key: string, values?: Record<string, string | number>) => string;

function useTx(): Tx {
  return useTranslations("clients.processes") as unknown as Tx;
}

/// Whether the reader reads right to left. The canvas itself stays left to
/// right (React Flow), but a node card reads in the page's direction, and
/// the exits of a condition follow it: the first branch where a line of
/// text starts.
function useRtl(): boolean {
  return useLocale() === intlTag("he");
}

const kindLabel = (t: Tx, n: FlowNode) => (n.send ? t("labels.nodeKinds.MAIL") : t(`labels.nodeKinds.${n.kind}`));

/// A flow issue (lib/process-flow) in the reader's language.
export function issueText(t: Tx, i: FlowIssue): string {
  if (!i.keyed) return i.message;
  const node = i.keyed.title ? `"${i.keyed.title}"` : t("flow.unnamedNode");
  return t(`flow.issues.${i.keyed.key}`, { ...i.keyed.values, node });
}

const emptyStep = (title: string): ProcessStep => ({
  title,
  mode: "MANUAL",
  offsetBusinessDays: null,
  actionTags: [],
  systemIds: [],
  output: null,
  verification: null,
  requiresApproval: false,
  amountMaxMinor: null,
  currency: null,
  channel: null,
});

/// A new node, titled in the language of whoever adds it: the title is the
/// author's text from then on, like any other they type.
export function blankNode(t: Tx, id: string, kind: FlowNodeKind, opts: { mail?: boolean } = {}): FlowNode {
  const title = t(`labels.nodeKinds.${opts.mail && kind === "ACTION" ? "MAIL" : kind}`);
  return {
    id,
    kind,
    title,
    waitBusinessDays: kind === "WAIT" ? 1 : null,
    owner: null,
    position: null,
    step: kind === "ACTION" ? emptyStep(title) : null,
    send: opts.mail ? { mode: "DRAFT", toContactId: null, toText: null, body: null } : null,
    next: null,
    question: kind === "CONDITION" ? "" : null,
    branches: kind === "CONDITION" ? [{ id: "b1", label: t("flow.defaultBranch"), source: "MANUAL", connectionId: null, ref: null, next: null }] : [],
    elseLabel: null,
    elseAfterBusinessDays: kind === "CONDITION" ? 3 : null,
    elseNext: null,
  };
}

function kindTone(n: FlowNode): string {
  if (n.kind === "CONDITION") return "bg-app-accent-soft text-app-text-accent";
  if (n.kind === "END") return "bg-app-success-soft text-app-success";
  if (n.kind === "WAIT") return "bg-app-neutral-soft text-app-text-secondary";
  return "bg-app-info-soft text-app-info";
}

function subline(t: Tx, n: FlowNode): string {
  const parts: string[] = [];
  if (n.waitBusinessDays) parts.push(t("flow.afterDays", { days: String(n.waitBusinessDays) }));
  if (n.send) parts.push(t(`labels.sendModes.${n.send.mode}`));
  else if (n.step) parts.push(t(`labels.stepModes.${n.step.mode}`));
  if (n.kind === "CONDITION") parts.push(t("flow.elseAfter", { days: String(n.elseAfterBusinessDays ?? "?") }));
  if (n.owner?.text) parts.push(t("flow.owner", { name: n.owner.text }));
  return parts.join(" · ");
}

type CardData = { node: FlowNode; selected: boolean; flagged: boolean; secondEye: boolean };

function NodeCard({ data }: NodeProps<Node<CardData>>) {
  const t = useTx();
  const rtl = useRtl();
  const n = data.node;
  const outs =
    n.kind === "CONDITION"
      ? [...n.branches.map((b) => ({ id: b.id, label: b.label || t(`labels.branchSources.${b.source}`) })), { id: "else", label: n.elseLabel || t("flow.otherwise") }]
      : n.kind === "END"
        ? []
        : [{ id: "next", label: "" }];
  // Where exit i sits along the bottom edge: from the right in Hebrew (as
  // it always was), from the left in English, under its label either way.
  const exitAt = (i: number) => ((rtl ? outs.length - 1 - i : i) + 0.5) / outs.length;
  return (
    <div
      dir={rtl ? "rtl" : "ltr"}
      style={{ width: NODE_W }}
      className={`rounded-xl border bg-white px-3 py-2.5 text-start shadow-sm ${data.selected ? "border-2 border-app-accent" : data.flagged ? "border-app-error" : "border-app-border"}`}
    >
      <Handle type="target" position={Position.Top} className="!h-2.5 !w-2.5 !bg-app-border-strong" />
      <div className="flex items-center justify-between gap-2">
        <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${kindTone(n)}`}>{kindLabel(t, n)}</span>
        {data.secondEye && <span className="rounded-md bg-app-warning-soft px-1.5 py-0.5 text-[11px] font-medium text-app-warning">{t("flow.secondEye")}</span>}
      </div>
      <p dir="auto" className="mt-1 text-[13px] font-medium text-app-text-primary">
        {n.kind === "CONDITION" ? n.question || n.title : n.title}
      </p>
      {subline(t, n) && <p className="mt-0.5 text-[11.5px] text-app-text-secondary">{subline(t, n)}</p>}
      {outs.length > 1 && (
        <div className="mt-2 flex justify-between gap-1">
          {outs.map((o) => (
            <span key={o.id} className="flex-1 truncate text-center text-[10.5px] text-app-text-secondary" title={o.label}>
              {o.label}
            </span>
          ))}
        </div>
      )}
      {outs.map((o, i) => (
        <Handle
          key={o.id}
          id={o.id}
          type="source"
          position={Position.Bottom}
          style={outs.length > 1 ? { left: `${exitAt(i) * 100}%` } : undefined}
          className="!h-2.5 !w-2.5 !bg-app-accent"
        />
      ))}
    </div>
  );
}

const nodeTypes = { card: NodeCard };

function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 900px)");
    const on = () => setDesktop(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return desktop;
}

export function FlowEditor(props: Props) {
  const t = useTx();
  const { flow, setFlow, selected, setSelected } = props;
  const desktop = useIsDesktop();

  const issues = useMemo(() => flowIssues(flow), [flow]);
  const eyes = useMemo(() => new Set(secondEyeNodes(flow).map((n) => n.id)), [flow]);
  const flagged = useMemo(() => new Set(issues.map((i) => i.node).filter(Boolean) as string[]), [issues]);
  const sel = flow.nodes.find((n) => n.id === selected) ?? null;

  const update = useCallback((id: string, patch: Partial<FlowNode>) => {
    setFlow((f) => ({ ...f, nodes: f.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }));
  }, [setFlow]);

  const addNode = (kind: FlowNodeKind, opts: { mail?: boolean } = {}) => {
    setFlow((f) => {
      const id = newId("n", f.nodes.map((n) => n.id));
      const node = blankNode(t, id, kind, opts);
      const from = f.nodes.find((n) => n.id === selected);
      // Below the selected node, moved aside while another node sits there.
      const spot = from?.position ? { x: from.position.x, y: from.position.y + 150 } : { x: 0, y: f.nodes.length * 150 };
      while (f.nodes.some((n) => n.position && Math.abs(n.position.x - spot.x) < NODE_W && Math.abs(n.position.y - spot.y) < 100)) spot.x += NODE_W + 50;
      node.position = spot;
      // Inserted after the selected node, when that node has one way on.
      let nodes = [...f.nodes, node];
      if (from && (from.kind === "ACTION" || from.kind === "WAIT")) {
        if (kind !== "END" && kind !== "CONDITION") node.next = from.next;
        if (kind === "CONDITION") node.branches = node.branches.map((b) => ({ ...b, next: from.next }));
        nodes = nodes.map((n) => (n.id === from.id ? { ...n, next: id } : n));
      }
      return { ...f, start: f.start ?? id, nodes };
    });
  };

  const removeNode = (id: string) => {
    setFlow((f) => {
      const gone = f.nodes.find((n) => n.id === id);
      const onward = gone && (gone.kind === "ACTION" || gone.kind === "WAIT") ? gone.next : null;
      const fix = (t: string | null) => (t === id ? onward : t);
      return {
        ...f,
        start: f.start === id ? onward : f.start,
        nodes: f.nodes
          .filter((n) => n.id !== id)
          .map((n) => ({ ...n, next: fix(n.next), elseNext: fix(n.elseNext), branches: n.branches.map((b) => ({ ...b, next: fix(b.next), ref: b.ref === id ? null : b.ref })) })),
      };
    });
    setSelected(null);
  };

  // Desktop canvas: the flow as React Flow nodes and edges.
  const rfNodes: Node<CardData>[] = flow.nodes.map((n) => ({
    id: n.id,
    type: "card",
    position: n.position ?? { x: 0, y: 0 },
    data: { node: n, selected: n.id === selected, flagged: flagged.has(n.id), secondEye: eyes.has(n.id) },
  }));
  const rfEdges: Edge[] = flow.nodes.flatMap((n) => {
    if (n.kind === "CONDITION") {
      return [
        ...n.branches.filter((b) => b.next).map((b) => ({ id: `${n.id}:${b.id}`, source: n.id, sourceHandle: b.id, target: b.next!, label: b.label || t(`labels.branchSources.${b.source}`) })),
        ...(n.elseNext ? [{ id: `${n.id}:else`, source: n.id, sourceHandle: "else", target: n.elseNext, label: n.elseLabel || t("flow.otherwiseEdge", { days: String(n.elseAfterBusinessDays ?? "?") }) }] : []),
      ];
    }
    return n.next ? [{ id: `${n.id}:next`, source: n.id, sourceHandle: "next", target: n.next }] : [];
  });

  const onNodesChange = (changes: NodeChange[]) => {
    for (const c of changes) {
      if (c.type === "position" && c.position) update(c.id, { position: { x: Math.round(c.position.x), y: Math.round(c.position.y) } });
    }
  };
  const onConnect = (c: Connection) => {
    if (!c.source || !c.target || c.source === c.target) return;
    const from = flow.nodes.find((n) => n.id === c.source);
    if (!from) return;
    if (from.kind === "CONDITION") {
      if (c.sourceHandle === "else") update(from.id, { elseNext: c.target });
      else update(from.id, { branches: from.branches.map((b) => (b.id === c.sourceHandle ? { ...b, next: c.target } : b)) });
    } else update(from.id, { next: c.target });
  };

  const others = flow.nodes.filter((n) => n.id !== sel?.id);
  const nextSelect = (value: string | null, onChange: (v: string | null) => void, label: string) => (
    <label className="flex flex-col gap-1 text-xs text-app-text-secondary">
      {label}
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} className={INPUT}>
        <option value="">{t("flow.notChosen")}</option>
        {others.map((o) => (
          <option key={o.id} value={o.id}>
            {o.kind === "CONDITION" ? o.question || o.title : o.title}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="flex flex-col gap-4" data-testid="flow-editor">
      <div className="flex flex-wrap gap-4">
        <section className="min-w-0 flex-[999_1_560px]">
          {desktop ? (
            <div dir="ltr" className="h-[70vh] min-h-[520px] overflow-hidden rounded-xl border border-app-border bg-app-surface-sunken">
              <ReactFlow
                nodes={rfNodes}
                edges={rfEdges}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                onConnect={onConnect}
                onNodeClick={(_, n) => setSelected(n.id)}
                onPaneClick={() => setSelected(null)}
                fitView
                fitViewOptions={{ maxZoom: 0.9, padding: 0.2 }}
                minZoom={0.3}
                proOptions={{ hideAttribution: true }}
              >
                <Background gap={20} />
                <Controls showInteractive={false} />
                <MiniMap pannable zoomable position="top-right" style={{ width: 160, height: 110 }} nodeColor="#B08D57" />
              </ReactFlow>
            </div>
          ) : (
            <MobileTree flow={flow} selected={selected} onSelect={setSelected} eyes={eyes} flagged={flagged} />
          )}
        </section>

        <aside className="flex flex-[1_1_300px] flex-col gap-4 rounded-xl border border-app-border bg-white p-4">
          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-app-text-primary">{sel ? t("flow.addAfter") : t("flow.addNode")}</h2>
            <div className="grid grid-cols-2 gap-2">
              {[
                [t("labels.nodeKinds.ACTION"), () => addNode("ACTION")],
                [t("labels.nodeKinds.MAIL"), () => addNode("ACTION", { mail: true })],
                [t("labels.nodeKinds.WAIT"), () => addNode("WAIT")],
                [t("labels.nodeKinds.CONDITION"), () => addNode("CONDITION")],
                [t("labels.nodeKinds.END"), () => addNode("END")],
              ].map(([label, fn]) => (
                <button key={label as string} type="button" onClick={fn as () => void} className="min-h-11 rounded-[10px] border border-app-border bg-app-surface-sunken text-sm text-app-text-primary hover:border-app-border-strong">
                  {label as string}
                </button>
              ))}
            </div>
          </div>

          {sel && (
            <div className="flex flex-col gap-3 border-t border-app-border pt-3" data-testid="flow-inspector">
              <div className="flex items-center justify-between">
                <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${kindTone(sel)}`}>{kindLabel(t, sel)}</span>
                <span className="flex gap-3 text-xs">
                  {flow.start !== sel.id && (
                    <button type="button" onClick={() => setFlow((f) => ({ ...f, start: sel.id }))} className="text-app-text-secondary hover:underline">
                      {t("flow.startHere")}
                    </button>
                  )}
                  <button type="button" onClick={() => removeNode(sel.id)} className="text-app-error hover:underline">
                    {t("flow.delete")}
                  </button>
                </span>
              </div>

              {sel.kind === "ACTION" && sel.step && !sel.send && props.stepPanel(sel)}

              {sel.kind !== "CONDITION" && !(sel.kind === "ACTION" && sel.step && !sel.send) && (
                <label className="flex flex-col gap-1 text-xs text-app-text-secondary">
                  {t("flow.whatDone")}
                  <input dir="auto" value={sel.title} onChange={(e) => update(sel.id, { title: e.target.value, step: sel.step ? { ...sel.step, title: e.target.value } : null })} className={INPUT} />
                </label>
              )}

              {sel.kind === "CONDITION" && (
                <label className="flex flex-col gap-1 text-xs text-app-text-secondary">
                  {t("flow.question")}
                  <input dir="auto" value={sel.question ?? ""} onChange={(e) => update(sel.id, { question: e.target.value, title: e.target.value })} className={INPUT} />
                </label>
              )}

              {sel.kind !== "END" && (
                <label className="flex flex-col gap-1 text-xs text-app-text-secondary">
                  {t("flow.waitDays")}
                  <input
                    inputMode="numeric"
                    value={sel.waitBusinessDays ?? ""}
                    onChange={(e) => update(sel.id, { waitBusinessDays: /^\d{1,2}$/.test(e.target.value) ? Number(e.target.value) : null })}
                    className={INPUT}
                  />
                </label>
              )}

              {sel.send && (
                <SendFields node={sel} contacts={props.contacts} onChange={(send) => update(sel.id, { send })} />
              )}

              {sel.kind === "CONDITION" && <ConditionFields node={sel} flow={flow} update={update} nextSelect={nextSelect} connections={props.connections} clientId={props.clientId} />}

              {(sel.kind === "ACTION" || sel.kind === "WAIT") && nextSelect(sel.next, (v) => update(sel.id, { next: v }), t("flow.continuesTo"))}
            </div>
          )}

          <p className="text-xs leading-relaxed text-app-text-tertiary">
            {desktop ? t("flow.helpDesktop") : t("flow.helpMobile")}
          </p>
        </aside>
      </div>
    </div>
  );
}

function SendFields({ node, contacts, onChange }: { node: FlowNode; contacts: { id: string; name: string }[]; onChange: (s: NonNullable<FlowNode["send"]>) => void }) {
  const t = useTx();
  const send = node.send!;
  return (
    <div className="flex flex-col gap-3 rounded-[10px] bg-app-surface-sunken p-3">
      <p className="text-xs text-app-text-secondary">{t("flow.sentFrom")}</p>
      <label className="flex flex-col gap-1 text-xs text-app-text-secondary">
        {t("flow.to")}
        <select value={send.toContactId ?? ""} onChange={(e) => onChange({ ...send, toContactId: e.target.value || null })} className={INPUT}>
          <option value="">{t("flow.noContact")}</option>
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-app-text-secondary">
        {t("flow.wording")}
        <textarea dir="auto" rows={4} value={send.body ?? ""} onChange={(e) => onChange({ ...send, body: e.target.value || null })} className={INPUT} />
      </label>
      <p className="text-[11px] text-app-text-tertiary">{t("flow.params", { params: MESSAGE_PARAMS.map((p) => `{{${p}}}`).join(" ") })}</p>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-xs text-app-text-secondary">{t("flow.howSent")}</legend>
        {(["DRAFT", "AUTO"] as const).map((m) => (
          <label key={m} className="flex items-center gap-2 text-sm text-app-text-primary">
            <input type="radio" name={`mode-${node.id}`} checked={send.mode === m} onChange={() => onChange({ ...send, mode: m })} className="h-4 w-4 accent-gold" />
            {t(`labels.sendModes.${m}`)}
          </label>
        ))}
      </fieldset>
      {send.mode === "AUTO" && <p className="rounded-md bg-app-warning-soft px-2 py-1.5 text-xs text-app-warning">{t("flow.autoWarning")}</p>}
    </div>
  );
}

function ConditionFields({
  node,
  flow,
  update,
  nextSelect,
  connections,
  clientId,
}: {
  node: FlowNode;
  flow: ProcessFlow;
  connections: Props["connections"];
  clientId: string;
  update: (id: string, patch: Partial<FlowNode>) => void;
  nextSelect: (value: string | null, onChange: (v: string | null) => void, label: string) => React.ReactNode;
}) {
  const t = useTx();
  const setBranch = (bid: string, patch: Partial<FlowBranch>) => update(node.id, { branches: node.branches.map((b) => (b.id === bid ? { ...b, ...patch } : b)) });
  const mailNodes = flow.nodes.filter((n) => n.send);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-app-text-secondary">{t("flow.branchOrder")}</p>
      {node.branches.map((b, i) => (
        <div key={b.id} className="flex flex-col gap-2 rounded-[10px] bg-app-surface-sunken p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-app-text-primary">{t("flow.branch", { n: i + 1 })}</span>
            <button type="button" onClick={() => update(node.id, { branches: node.branches.filter((x) => x.id !== b.id) })} className="text-xs text-app-error hover:underline">
              {t("flow.remove")}
            </button>
          </div>
          <input aria-label={t("flow.branchNameAria", { n: i + 1 })} dir="auto" value={b.label} onChange={(e) => setBranch(b.id, { label: e.target.value })} placeholder={t("flow.branchPlaceholder")} className={INPUT} />
          <select aria-label={t("flow.sourceAria", { n: i + 1 })} value={b.source} onChange={(e) => setBranch(b.id, { source: e.target.value as BranchSource })} className={INPUT}>
            {(Object.keys(BRANCH_SOURCE_LABELS) as BranchSource[]).map((s) => (
              <option key={s} value={s}>
                {t(`labels.branchSources.${s}`)}
              </option>
            ))}
          </select>
          {b.source === "EMAIL_REPLY" && (
            <select aria-label={t("flow.replyAria", { n: i + 1 })} value={b.ref ?? ""} onChange={(e) => setBranch(b.id, { ref: e.target.value || null })} className={INPUT}>
              <option value="">{t("flow.replyTo")}</option>
              {mailNodes.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </select>
          )}
          {(b.source === "EMAIL_REPLY" || b.source === "DRIVE_FILE") && (
            <>
              <select aria-label={t("flow.connectionAria", { n: i + 1 })} value={b.connectionId ?? ""} onChange={(e) => setBranch(b.id, { connectionId: e.target.value || null })} className={INPUT}>
                <option value="">{t("flow.clientConnection")}</option>
                {connections
                  .filter((c) => (b.source === "DRIVE_FILE" ? c.kind === "GOOGLE_OAUTH" : c.kind !== "MANAGER_SEND"))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.account}
                    </option>
                  ))}
              </select>
              {b.source === "DRIVE_FILE" && (
                <input aria-label={t("flow.folderAria", { n: i + 1 })} dir="ltr" value={b.ref ?? ""} onChange={(e) => setBranch(b.id, { ref: e.target.value.trim() || null })} placeholder={t("flow.folderPlaceholder")} className={INPUT} />
              )}
              <a href={`/app/clients/${clientId}/connections`} className="text-[11px] text-app-text-accent hover:underline">
                {t("flow.manageConnections")}
              </a>
            </>
          )}
          {nextSelect(b.next, (v) => setBranch(b.id, { next: v }), t("flow.continuesTo"))}
        </div>
      ))}
      <button
        type="button"
        onClick={() => update(node.id, { branches: [...node.branches, { id: newId("b", node.branches.map((b) => b.id)), label: "", source: "MANUAL", connectionId: null, ref: null, next: null }] })}
        className="min-h-11 rounded-[10px] border border-dashed border-app-border-strong text-sm text-app-text-primary"
      >
        {t("flow.addBranch")}
      </button>
      <div className="flex flex-col gap-2 rounded-[10px] border border-dashed border-app-border-strong p-3">
        <span className="text-xs font-medium text-app-text-primary">{t("flow.otherwise")}</span>
        <label className="flex items-center gap-2 text-sm text-app-text-primary">
          {t("flow.after")}
          <input
            inputMode="numeric"
            aria-label={t("flow.elseDays")}
            value={node.elseAfterBusinessDays ?? ""}
            onChange={(e) => update(node.id, { elseAfterBusinessDays: /^\d{1,2}$/.test(e.target.value) ? Number(e.target.value) : null })}
            className="h-11 w-16 rounded-[10px] border border-app-border-strong text-center"
          />
          {t("flow.elseDays")}
        </label>
        {nextSelect(node.elseNext, (v) => update(node.id, { elseNext: v }), t("flow.continuesTo"))}
      </div>
    </div>
  );
}

function MobileTree({ flow, selected, onSelect, eyes, flagged }: { flow: ProcessFlow; selected: string | null; onSelect: (id: string) => void; eyes: Set<string>; flagged: Set<string> }) {
  const t = useTx();
  const lines = flowTree(flow, { source: (s) => t(`labels.branchSources.${s}`), otherwise: (days) => t("flow.otherwiseTree", { days: String(days ?? "?") }) });
  return (
    <ol className="flex flex-col gap-2" data-testid="flow-tree">
      {lines.map((l, i) => (
        <li key={i} style={{ paddingInlineStart: `${l.depth * 16}px` }}>
          {l.branch && <span className="mb-1 inline-block rounded-full bg-app-neutral-soft px-2 py-0.5 text-[11px] text-app-text-secondary">{l.branch}</span>}
          {l.type === "goto" ? (
            <p className="text-xs text-app-text-secondary">↓ {t("flow.goto", { target: l.target.kind === "CONDITION" ? l.target.question || l.target.title : l.target.title })}</p>
          ) : (
            <button
              type="button"
              onClick={() => onSelect(l.node.id)}
              className={`flex w-full flex-col gap-0.5 rounded-xl border bg-white px-3 py-2.5 text-start ${l.node.id === selected ? "border-2 border-app-accent" : flagged.has(l.node.id) ? "border-app-error" : "border-app-border"}`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${kindTone(l.node)}`}>{kindLabel(t, l.node)}</span>
                {eyes.has(l.node.id) && <span className="text-[11px] font-medium text-app-warning">{t("flow.secondEye")}</span>}
              </span>
              <span dir="auto" className="text-sm font-medium text-app-text-primary">
                {l.node.kind === "CONDITION" ? l.node.question || l.node.title : l.node.title}
              </span>
              {subline(t, l.node) && <span className="text-xs text-app-text-secondary">{subline(t, l.node)}</span>}
            </button>
          )}
        </li>
      ))}
      {lines.length === 0 && <li className="text-sm text-app-text-secondary">{t("flow.emptyTree")}</li>}
    </ol>
  );
}
