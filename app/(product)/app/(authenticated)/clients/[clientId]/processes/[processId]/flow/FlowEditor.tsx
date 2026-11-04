"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { Background, Controls, Handle, MiniMap, Position, ReactFlow, type Connection, type Edge, type Node, type NodeChange, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  BRANCH_SOURCE_LABELS,
  MESSAGE_PARAMS,
  SEND_MODE_LABELS,
  flowIssues,
  flowTree,
  secondEyeNodes,
  type BranchSource,
  type FlowBranch,
  type FlowNode,
  type FlowNodeKind,
  type ProcessFlow,
} from "@/lib/process-flow";
import { STEP_MODE_LABELS, type ProcessStep, type StepModeLike } from "@/lib/process-rules";
import { saveAndActivateFlowAction } from "../../../../process-actions";
import { autoPositions, newId, NODE_W } from "./flow-layout";

// The procedure flow editor (task cmvtivumj000pjs08q9qj4t67, design
// https://claude.ai/artifact/CjzpzkxiB8xRvpaZNBWkAr, Ariel 4.11.2026): a
// free canvas on a computer (React Flow), a vertical tree on a phone, one
// flow under both. "שמור והפעל" puts it live, unless it needs a second
// pair of eyes.

type Props = {
  clientId: string;
  processId: string;
  code: string;
  title: string;
  triggerText: string | null;
  latestVersion: number;
  latestStatus: "DRAFT" | "APPROVED" | "SUPERSEDED" | null;
  initial: ProcessFlow;
  fromList: boolean;
  highlights: string | null;
  outputs: string | null;
  contacts: { id: string; name: string }[];
  connections: { id: string; kind: "GOOGLE_OAUTH" | "MAIL_APP_PASSWORD" | "MANAGER_SEND"; account: string }[];
};

const INPUT = "w-full rounded-[10px] border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary";
const KIND_LABELS: Record<FlowNodeKind, string> = { ACTION: "פעולה", WAIT: "המתנה", CONDITION: "תנאי", END: "סיום" };

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

function blankNode(id: string, kind: FlowNodeKind, opts: { mail?: boolean } = {}): FlowNode {
  const title = kind === "END" ? "סיום" : kind === "WAIT" ? "המתנה" : kind === "CONDITION" ? "תנאי" : opts.mail ? "שליחת מייל" : "פעולה";
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
    branches: kind === "CONDITION" ? [{ id: "b1", label: "כן", source: "MANUAL", connectionId: null, ref: null, next: null }] : [],
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

function subline(n: FlowNode): string {
  const parts: string[] = [];
  if (n.waitBusinessDays) parts.push(`אחרי ${n.waitBusinessDays} ימי עסקים`);
  if (n.send) parts.push(SEND_MODE_LABELS[n.send.mode]);
  else if (n.step) parts.push(STEP_MODE_LABELS[n.step.mode]);
  if (n.kind === "CONDITION") parts.push(`"אחרת" אחרי ${n.elseAfterBusinessDays ?? "?"} ימים`);
  if (n.owner?.text) parts.push(`אחראי: ${n.owner.text}`);
  return parts.join(" · ");
}

type CardData = { node: FlowNode; selected: boolean; flagged: boolean; secondEye: boolean };

function NodeCard({ data }: NodeProps<Node<CardData>>) {
  const n = data.node;
  const outs = n.kind === "CONDITION" ? [...n.branches.map((b) => ({ id: b.id, label: b.label || BRANCH_SOURCE_LABELS[b.source] })), { id: "else", label: n.elseLabel || "אחרת" }] : n.kind === "END" ? [] : [{ id: "next", label: "" }];
  return (
    <div
      dir="rtl"
      style={{ width: NODE_W }}
      className={`rounded-xl border bg-white px-3 py-2.5 text-start shadow-sm ${data.selected ? "border-2 border-app-accent" : data.flagged ? "border-app-error" : "border-app-border"}`}
    >
      <Handle type="target" position={Position.Top} className="!h-2.5 !w-2.5 !bg-app-border-strong" />
      <div className="flex items-center justify-between gap-2">
        <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${kindTone(n)}`}>{n.send ? "שליחת מייל" : KIND_LABELS[n.kind]}</span>
        {data.secondEye && <span className="rounded-md bg-app-warning-soft px-1.5 py-0.5 text-[11px] font-medium text-app-warning">עין שנייה</span>}
      </div>
      <p className="mt-1 text-[13px] font-medium text-app-text-primary">{n.kind === "CONDITION" ? n.question || n.title : n.title}</p>
      {subline(n) && <p className="mt-0.5 text-[11.5px] text-app-text-secondary">{subline(n)}</p>}
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
          style={outs.length > 1 ? { left: `${((outs.length - 1 - i + 0.5) / outs.length) * 100}%` } : undefined}
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
  const [flow, setFlow] = useState<ProcessFlow>(() => {
    const pos = autoPositions(props.initial);
    return { ...props.initial, nodes: props.initial.nodes.map((n) => ({ ...n, position: n.position ?? pos.get(n.id) ?? { x: 0, y: 0 } })) };
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [base, setBase] = useState(props.latestVersion);
  const [message, setMessage] = useState<{ tone: "ok" | "wait" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const desktop = useIsDesktop();

  const issues = useMemo(() => flowIssues(flow), [flow]);
  const eyes = useMemo(() => new Set(secondEyeNodes(flow).map((n) => n.id)), [flow]);
  const flagged = useMemo(() => new Set(issues.map((i) => i.node).filter(Boolean) as string[]), [issues]);
  const sel = flow.nodes.find((n) => n.id === selected) ?? null;

  const update = useCallback((id: string, patch: Partial<FlowNode>) => {
    setFlow((f) => ({ ...f, nodes: f.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }));
    setMessage(null);
  }, []);

  const addNode = (kind: FlowNodeKind, opts: { mail?: boolean } = {}) => {
    setFlow((f) => {
      const id = newId("n", f.nodes.map((n) => n.id));
      const node = blankNode(id, kind, opts);
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
    setMessage(null);
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
        ...n.branches.filter((b) => b.next).map((b) => ({ id: `${n.id}:${b.id}`, source: n.id, sourceHandle: b.id, target: b.next!, label: b.label || BRANCH_SOURCE_LABELS[b.source] })),
        ...(n.elseNext ? [{ id: `${n.id}:else`, source: n.id, sourceHandle: "else", target: n.elseNext, label: n.elseLabel || `אחרת, ${n.elseAfterBusinessDays ?? "?"} ימים` }] : []),
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

  const save = () => {
    setMessage(null);
    start(async () => {
      const res = await saveAndActivateFlowAction({ clientId: props.clientId, processId: props.processId, flow, baseVersion: base, highlights: props.highlights, outputs: props.outputs });
      if (res.error || !res.result) {
        setMessage({ tone: "error", text: res.error ?? "השמירה נכשלה." });
        return;
      }
      setBase(res.result.version);
      setMessage(res.result.live ? { tone: "ok", text: `הנוהל פעיל, בגרסה ${res.result.version}. ריצות שכבר התחילו ממשיכות לפי הגרסה הקודמת.` } : { tone: "wait", text: `נשמר כגרסה ${res.result.version}, עוד לא פעיל. ${res.result.reason}` });
    });
  };

  const others = flow.nodes.filter((n) => n.id !== sel?.id);
  const nextSelect = (value: string | null, onChange: (v: string | null) => void, label: string) => (
    <label className="flex flex-col gap-1 text-xs text-app-text-secondary">
      {label}
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} className={INPUT}>
        <option value="">לא נבחר</option>
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
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-app-border bg-white px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-app-text-secondary">
            {props.code} · {props.triggerText ? `התחלה: ${props.triggerText}` : "בלי טריגר מוגדר"}
          </span>
          <h1 className="text-lg font-medium text-app-text-primary">{props.title}</h1>
          <a href={`/app/clients/${props.clientId}/connections`} className="text-xs text-app-text-accent hover:underline" data-testid="flow-connections-link">
            חיבורים של הלקוח ({props.connections.length})
          </a>
          {props.fromList && <span className="text-xs text-app-text-tertiary">הנוהל נשמר עד היום כרשימה, והומר לזרימה. שום דבר לא נשמר עד שלוחצים על &quot;שמור והפעל&quot;.</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-xs ${issues.length ? "text-app-error" : "text-app-success"}`}>{issues.length ? `${issues.length} בעיות חוסמות` : "כל הבדיקות עברו"}</span>
          <button type="button" onClick={save} disabled={pending || issues.length > 0} className="h-11 rounded-[10px] bg-app-surface-nav px-5 text-sm font-medium text-app-surface-page disabled:opacity-50" data-testid="flow-save">
            {pending ? "שומר..." : "שמור והפעל"}
          </button>
        </div>
      </header>

      {message && (
        <p
          role="status"
          data-testid="flow-message"
          className={`rounded-[10px] px-3 py-2 text-sm ${message.tone === "ok" ? "bg-app-success-soft text-app-success" : message.tone === "wait" ? "bg-app-warning-soft text-app-warning" : "bg-app-error-soft text-app-error"}`}
        >
          {message.text}
        </p>
      )}

      {issues.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-[10px] border border-app-error/30 bg-app-error-soft px-3 py-2" data-testid="flow-issues">
          {issues.map((i, k) => (
            <li key={k} className="text-xs text-app-error">
              {i.node ? (
                <button type="button" onClick={() => setSelected(i.node!)} className="text-start hover:underline">
                  {i.message}
                </button>
              ) : (
                i.message
              )}
            </li>
          ))}
        </ul>
      )}

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
            <h2 className="text-sm font-medium text-app-text-primary">{sel ? "הוספה אחרי הצומת הנבחר" : "הוספת צומת"}</h2>
            <div className="grid grid-cols-2 gap-2">
              {[
                ["פעולה", () => addNode("ACTION")],
                ["שליחת מייל", () => addNode("ACTION", { mail: true })],
                ["המתנה", () => addNode("WAIT")],
                ["תנאי", () => addNode("CONDITION")],
                ["סיום", () => addNode("END")],
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
                <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${kindTone(sel)}`}>{sel.send ? "שליחת מייל" : KIND_LABELS[sel.kind]}</span>
                <span className="flex gap-3 text-xs">
                  {flow.start !== sel.id && (
                    <button type="button" onClick={() => setFlow((f) => ({ ...f, start: sel.id }))} className="text-app-text-secondary hover:underline">
                      להתחיל מכאן
                    </button>
                  )}
                  <button type="button" onClick={() => removeNode(sel.id)} className="text-app-error hover:underline">
                    מחיקה
                  </button>
                </span>
              </div>

              {sel.kind !== "CONDITION" && (
                <label className="flex flex-col gap-1 text-xs text-app-text-secondary">
                  מה עושים
                  <input value={sel.title} onChange={(e) => update(sel.id, { title: e.target.value, step: sel.step ? { ...sel.step, title: e.target.value } : null })} className={INPUT} />
                </label>
              )}

              {sel.kind === "CONDITION" && (
                <label className="flex flex-col gap-1 text-xs text-app-text-secondary">
                  השאלה
                  <input value={sel.question ?? ""} onChange={(e) => update(sel.id, { question: e.target.value, title: e.target.value })} className={INPUT} />
                </label>
              )}

              {sel.kind !== "END" && (
                <label className="flex flex-col gap-1 text-xs text-app-text-secondary">
                  ימי עסקים להמתין לפני הצומת
                  <input
                    inputMode="numeric"
                    value={sel.waitBusinessDays ?? ""}
                    onChange={(e) => update(sel.id, { waitBusinessDays: /^\d{1,2}$/.test(e.target.value) ? Number(e.target.value) : null })}
                    className={INPUT}
                  />
                </label>
              )}

              {sel.kind === "ACTION" && sel.step && !sel.send && (
                <label className="flex flex-col gap-1 text-xs text-app-text-secondary">
                  איך
                  <select value={sel.step.mode} onChange={(e) => update(sel.id, { step: { ...sel.step!, mode: e.target.value as StepModeLike } })} className={INPUT}>
                    {(Object.keys(STEP_MODE_LABELS) as StepModeLike[]).map((m) => (
                      <option key={m} value={m}>
                        {STEP_MODE_LABELS[m]}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {sel.kind === "ACTION" && (
                <label className="flex flex-col gap-1 text-xs text-app-text-secondary">
                  אחראי, אם לא מבצע התהליך
                  <input value={sel.owner?.text ?? ""} onChange={(e) => update(sel.id, { owner: e.target.value ? { userId: null, contactId: null, text: e.target.value } : null })} placeholder="למשל: הלקוח" className={INPUT} />
                </label>
              )}

              {sel.send && (
                <SendFields node={sel} contacts={props.contacts} onChange={(send) => update(sel.id, { send })} />
              )}

              {sel.kind === "CONDITION" && <ConditionFields node={sel} flow={flow} update={update} nextSelect={nextSelect} connections={props.connections} clientId={props.clientId} />}

              {(sel.kind === "ACTION" || sel.kind === "WAIT") && nextSelect(sel.next, (v) => update(sel.id, { next: v }), "ממשיך ל")}
            </div>
          )}

          <p className="text-xs leading-relaxed text-app-text-tertiary">
            {desktop ? "גוררים צומת כדי להזיז אותו, ומושכים קו מהנקודה התחתונה לצומת אחר כדי לחבר." : "לוחצים על צומת כדי לערוך אותו. במחשב יש קנבס עם גרירה."}
          </p>
        </aside>
      </div>
    </div>
  );
}

function SendFields({ node, contacts, onChange }: { node: FlowNode; contacts: { id: string; name: string }[]; onChange: (s: NonNullable<FlowNode["send"]>) => void }) {
  const send = node.send!;
  return (
    <div className="flex flex-col gap-3 rounded-[10px] bg-app-surface-sunken p-3">
      <p className="text-xs text-app-text-secondary">נשלח מהתיבה של מנהל התיק.</p>
      <label className="flex flex-col gap-1 text-xs text-app-text-secondary">
        אל
        <select value={send.toContactId ?? ""} onChange={(e) => onChange({ ...send, toContactId: e.target.value || null })} className={INPUT}>
          <option value="">לא נבחר איש קשר</option>
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-app-text-secondary">
        נוסח
        <textarea rows={4} value={send.body ?? ""} onChange={(e) => onChange({ ...send, body: e.target.value || null })} className={INPUT} />
      </label>
      <p className="text-[11px] text-app-text-tertiary">פרמטרים: {MESSAGE_PARAMS.map((p) => `{{${p}}}`).join(" ")}</p>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-xs text-app-text-secondary">איך נשלח</legend>
        {(["DRAFT", "AUTO"] as const).map((m) => (
          <label key={m} className="flex items-center gap-2 text-sm text-app-text-primary">
            <input type="radio" name={`mode-${node.id}`} checked={send.mode === m} onChange={() => onChange({ ...send, mode: m })} className="h-4 w-4 accent-gold" />
            {SEND_MODE_LABELS[m]}
          </label>
        ))}
      </fieldset>
      {send.mode === "AUTO" && <p className="rounded-md bg-app-warning-soft px-2 py-1.5 text-xs text-app-warning">שליחה אוטומטית עוברת עין שנייה פעם אחת, וצריכה נוסח קבוע. עד האישור, הגרסה הקודמת ממשיכה לרוץ.</p>}
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
  const setBranch = (bid: string, patch: Partial<FlowBranch>) => update(node.id, { branches: node.branches.map((b) => (b.id === bid ? { ...b, ...patch } : b)) });
  const mailNodes = flow.nodes.filter((n) => n.send);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-app-text-secondary">הענפים נבדקים לפי הסדר. הראשון שמתקיים זוכה.</p>
      {node.branches.map((b, i) => (
        <div key={b.id} className="flex flex-col gap-2 rounded-[10px] bg-app-surface-sunken p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-app-text-primary">ענף {i + 1}</span>
            <button type="button" onClick={() => update(node.id, { branches: node.branches.filter((x) => x.id !== b.id) })} className="text-xs text-app-error hover:underline">
              הסרה
            </button>
          </div>
          <input aria-label={`ענף ${i + 1}: שם`} value={b.label} onChange={(e) => setBranch(b.id, { label: e.target.value })} placeholder="למשל: הגיע קובץ" className={INPUT} />
          <select aria-label={`ענף ${i + 1}: מקור התשובה`} value={b.source} onChange={(e) => setBranch(b.id, { source: e.target.value as BranchSource })} className={INPUT}>
            {(Object.keys(BRANCH_SOURCE_LABELS) as BranchSource[]).map((s) => (
              <option key={s} value={s}>
                {BRANCH_SOURCE_LABELS[s]}
              </option>
            ))}
          </select>
          {b.source === "EMAIL_REPLY" && (
            <select aria-label={`ענף ${i + 1}: תשובה לאיזה מייל`} value={b.ref ?? ""} onChange={(e) => setBranch(b.id, { ref: e.target.value || null })} className={INPUT}>
              <option value="">תשובה לאיזה מייל</option>
              {mailNodes.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </select>
          )}
          {(b.source === "EMAIL_REPLY" || b.source === "DRIVE_FILE") && (
            <>
              <select aria-label={`ענף ${i + 1}: חיבור`} value={b.connectionId ?? ""} onChange={(e) => setBranch(b.id, { connectionId: e.target.value || null })} className={INPUT}>
                <option value="">חיבור של הלקוח</option>
                {connections
                  .filter((c) => (b.source === "DRIVE_FILE" ? c.kind === "GOOGLE_OAUTH" : c.kind !== "MANAGER_SEND"))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.account}
                    </option>
                  ))}
              </select>
              {b.source === "DRIVE_FILE" && (
                <input aria-label={`ענף ${i + 1}: מזהה תיקייה בדרייב`} dir="ltr" value={b.ref ?? ""} onChange={(e) => setBranch(b.id, { ref: e.target.value.trim() || null })} placeholder="מזהה התיקייה בדרייב" className={INPUT} />
              )}
              <a href={`/app/clients/${clientId}/connections`} className="text-[11px] text-app-text-accent hover:underline">
                ניהול החיבורים של הלקוח
              </a>
            </>
          )}
          {nextSelect(b.next, (v) => setBranch(b.id, { next: v }), "ממשיך ל")}
        </div>
      ))}
      <button
        type="button"
        onClick={() => update(node.id, { branches: [...node.branches, { id: newId("b", node.branches.map((b) => b.id)), label: "", source: "MANUAL", connectionId: null, ref: null, next: null }] })}
        className="min-h-11 rounded-[10px] border border-dashed border-app-border-strong text-sm text-app-text-primary"
      >
        + ענף נוסף
      </button>
      <div className="flex flex-col gap-2 rounded-[10px] border border-dashed border-app-border-strong p-3">
        <span className="text-xs font-medium text-app-text-primary">אחרת</span>
        <label className="flex items-center gap-2 text-sm text-app-text-primary">
          אחרי
          <input
            inputMode="numeric"
            aria-label="ימי עסקים בלי תשובה"
            value={node.elseAfterBusinessDays ?? ""}
            onChange={(e) => update(node.id, { elseAfterBusinessDays: /^\d{1,2}$/.test(e.target.value) ? Number(e.target.value) : null })}
            className="h-11 w-16 rounded-[10px] border border-app-border-strong text-center"
          />
          ימי עסקים בלי תשובה
        </label>
        {nextSelect(node.elseNext, (v) => update(node.id, { elseNext: v }), "ממשיך ל")}
      </div>
    </div>
  );
}

function MobileTree({ flow, selected, onSelect, eyes, flagged }: { flow: ProcessFlow; selected: string | null; onSelect: (id: string) => void; eyes: Set<string>; flagged: Set<string> }) {
  const lines = flowTree(flow);
  return (
    <ol className="flex flex-col gap-2" data-testid="flow-tree">
      {lines.map((l, i) => (
        <li key={i} style={{ paddingInlineStart: `${l.depth * 16}px` }}>
          {l.branch && <span className="mb-1 inline-block rounded-full bg-app-neutral-soft px-2 py-0.5 text-[11px] text-app-text-secondary">{l.branch}</span>}
          {l.type === "goto" ? (
            <p className="text-xs text-app-text-secondary">↓ ממשיך ל: {l.target.kind === "CONDITION" ? l.target.question || l.target.title : l.target.title}</p>
          ) : (
            <button
              type="button"
              onClick={() => onSelect(l.node.id)}
              className={`flex w-full flex-col gap-0.5 rounded-xl border bg-white px-3 py-2.5 text-start ${l.node.id === selected ? "border-2 border-app-accent" : flagged.has(l.node.id) ? "border-app-error" : "border-app-border"}`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${kindTone(l.node)}`}>{l.node.send ? "שליחת מייל" : KIND_LABELS[l.node.kind]}</span>
                {eyes.has(l.node.id) && <span className="text-[11px] font-medium text-app-warning">עין שנייה</span>}
              </span>
              <span className="text-sm font-medium text-app-text-primary">{l.node.kind === "CONDITION" ? l.node.question || l.node.title : l.node.title}</span>
              {subline(l.node) && <span className="text-xs text-app-text-secondary">{subline(l.node)}</span>}
            </button>
          )}
        </li>
      ))}
      {lines.length === 0 && <li className="text-sm text-app-text-secondary">אין עדיין צמתים. מוסיפים צומת ראשון מהרשימה.</li>}
    </ol>
  );
}
