// A procedure as a flow (task cmvtivumj000pjs08q9qj4t67, 4.11.2026): nodes
// joined by "next", with conditions that split into branches and branches
// that meet again. Pure, like lib/process-rules.ts, so the editor, the
// server and the tests read a flow the same way.
//
// Decisions behind the shape (Ariel, 4.11.2026, recorded on the task):
// - A graph, not a tree: a branch may continue to a node another branch
//   reaches too ("ממשיך ל"). No loops.
// - Days count from the node before, inside a branch. A procedure with no
//   condition keeps counting from the run's start, as the list did.
// - A condition picks the first branch that holds, from a source: a person
//   answers in the run's task, a reply arrives in a mail thread, a file
//   appears in a Drive folder, or Claude checks. "Else" always exists and
//   fires after a number of business days.
// - Every action node holds a ProcessStep, so the list every other reader
//   uses (runs, documents, checks) is derived from the flow, not kept beside
//   it: flowSteps() below.

import { MAX_PROCESS_STEPS, MONEY_TAGS, readSteps, type ProcessStep } from "@/lib/process-rules";

export const MAX_FLOW_NODES = 40;
export const MAX_BRANCHES = 6;

export type FlowNodeKind = "ACTION" | "WAIT" | "CONDITION" | "END";
export type BranchSource = "MANUAL" | "EMAIL_REPLY" | "DRIVE_FILE" | "CLAUDE";
export type SendMode = "DRAFT" | "AUTO";

export const BRANCH_SOURCE_LABELS: Record<BranchSource, string> = {
  MANUAL: "אדם עונה במשימה",
  EMAIL_REPLY: "הגיעה תשובה במייל",
  DRIVE_FILE: "הופיע קובץ בדרייב",
  CLAUDE: "קלוד בודק",
};

export const SEND_MODE_LABELS: Record<SendMode, string> = {
  DRAFT: "טיוטה, אדם שולח",
  AUTO: "שליחה אוטומטית",
};

/// What a fixed message may fill in when it goes out (Ariel, 4.11.2026):
/// written {{like this}} in the wording. A closed list, so the wording a
/// person approved is the wording that leaves, with only these values in it.
export const MESSAGE_PARAMS = ["שם איש הקשר", "שם הלקוח", "חודש", "תאריך", "מנהל התיק", "קישור לתיקייה"] as const;
export type MessageParam = (typeof MESSAGE_PARAMS)[number];

/// The {{parameters}} a wording uses, and the ones it uses that do not exist.
export function messageParams(body: string): { used: MessageParam[]; unknown: string[] } {
  const names = [...body.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map((m) => m[1]);
  const used = [...new Set(names.filter((n): n is MessageParam => (MESSAGE_PARAMS as readonly string[]).includes(n)))];
  const unknown = [...new Set(names.filter((n) => !(MESSAGE_PARAMS as readonly string[]).includes(n)))];
  return { used, unknown };
}

/// How a person makes sure an automatic mail went out (R3), unless the
/// editor wrote another.
export const SENT_MAIL_VERIFICATION = "המייל מופיע בתיקיית \"נשלח\" של מנהל התיק, ונרשם ביומן הביקורת.";

/// Who does a node, when it is not the process's executor.
export type FlowOwner = { userId: string | null; contactId: string | null; text: string | null };

/// What a send-mail action adds to its step. It goes out from the account
/// manager's mailbox (Ariel, 4.11.2026).
export type FlowSend = { mode: SendMode; toContactId: string | null; toText: string | null; body: string | null };

export type FlowBranch = {
  id: string;
  label: string;
  source: BranchSource;
  /// The client connection the source reads through (EMAIL_REPLY, DRIVE_FILE).
  connectionId: string | null;
  /// EMAIL_REPLY: the node whose mail opened the thread. DRIVE_FILE: the
  /// folder id the client picked.
  ref: string | null;
  next: string | null;
};

export type FlowNode = {
  id: string;
  kind: FlowNodeKind;
  title: string;
  /// Business days to wait after the node before, before this one starts.
  waitBusinessDays: number | null;
  owner: FlowOwner | null;
  /// Where the desktop canvas drew it. Kept so a layout survives a save.
  position: { x: number; y: number } | null;
  /// ACTION.
  step: ProcessStep | null;
  send: FlowSend | null;
  /// ACTION, WAIT.
  next: string | null;
  /// CONDITION: the question, its branches in order, and "else".
  question: string | null;
  branches: FlowBranch[];
  elseLabel: string | null;
  elseAfterBusinessDays: number | null;
  elseNext: string | null;
};

export type ProcessFlow = { v: 1; start: string | null; nodes: FlowNode[] };

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};
const id = (v: unknown): string | null => (typeof v === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : null);
const days = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 60 ? v : null);
const pick = <T extends string>(v: unknown, of: readonly T[], fallback: T): T => (of.includes(v as T) ? (v as T) : fallback);

function readOwner(v: unknown): FlowOwner | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const owner = { userId: id(o.userId), contactId: id(o.contactId), text: str(o.text, 120) };
  return owner.userId || owner.contactId || owner.text ? owner : null;
}

function readBranch(v: unknown): FlowBranch | null {
  if (!v || typeof v !== "object") return null;
  const b = v as Record<string, unknown>;
  const bid = id(b.id);
  if (!bid) return null;
  return {
    id: bid,
    label: str(b.label, 80) ?? "",
    source: pick(b.source, ["MANUAL", "EMAIL_REPLY", "DRIVE_FILE", "CLAUDE"] as const, "MANUAL"),
    connectionId: id(b.connectionId),
    ref: str(b.ref, 200),
    next: id(b.next),
  };
}

/// Whatever was stored or sent, as a flow. Unknown kinds and fields are
/// dropped rather than trusted, as readSteps does for the list.
export function readFlow(value: unknown): ProcessFlow | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.nodes)) return null;
  const nodes: FlowNode[] = [];
  for (const v of raw.nodes.slice(0, MAX_FLOW_NODES)) {
    if (!v || typeof v !== "object") continue;
    const n = v as Record<string, unknown>;
    const nid = id(n.id);
    if (!nid) continue;
    const kind = pick(n.kind, ["ACTION", "WAIT", "CONDITION", "END"] as const, "ACTION");
    const step = kind === "ACTION" ? (readSteps([{ ...(n.step as object), title: (n.step as Record<string, unknown> | undefined)?.title ?? n.title }])[0] ?? null) : null;
    const sendRaw = kind === "ACTION" && n.send && typeof n.send === "object" ? (n.send as Record<string, unknown>) : null;
    const pos = n.position && typeof n.position === "object" ? (n.position as Record<string, unknown>) : null;
    nodes.push({
      id: nid,
      kind,
      title: str(n.title, 200) ?? step?.title ?? "",
      waitBusinessDays: days(n.waitBusinessDays),
      owner: readOwner(n.owner),
      position: pos && Number.isFinite(pos.x) && Number.isFinite(pos.y) ? { x: Math.round(pos.x as number), y: Math.round(pos.y as number) } : null,
      step,
      send: sendRaw
        ? { mode: pick(sendRaw.mode, ["DRAFT", "AUTO"] as const, "DRAFT"), toContactId: id(sendRaw.toContactId), toText: str(sendRaw.toText, 200), body: str(sendRaw.body, 4000) }
        : null,
      next: kind === "ACTION" || kind === "WAIT" ? id(n.next) : null,
      question: kind === "CONDITION" ? str(n.question, 200) : null,
      branches: kind === "CONDITION" && Array.isArray(n.branches) ? n.branches.slice(0, MAX_BRANCHES).map(readBranch).filter((b): b is FlowBranch => !!b) : [],
      elseLabel: kind === "CONDITION" ? str(n.elseLabel, 80) : null,
      elseAfterBusinessDays: kind === "CONDITION" ? days(n.elseAfterBusinessDays) : null,
      elseNext: kind === "CONDITION" ? id(n.elseNext) : null,
    });
  }
  return { v: 1, start: id(raw.start), nodes };
}

/// Where a node goes next: one target, or one per branch plus "else".
export function nextOf(n: FlowNode): (string | null)[] {
  if (n.kind === "CONDITION") return [...n.branches.map((b) => b.next), n.elseNext];
  if (n.kind === "END") return [];
  return [n.next];
}

const emptyNode = (nid: string, kind: FlowNodeKind, title: string): FlowNode => ({
  id: nid,
  kind,
  title,
  waitBusinessDays: null,
  owner: null,
  position: null,
  step: null,
  send: null,
  next: null,
  question: null,
  branches: [],
  elseLabel: null,
  elseAfterBusinessDays: null,
  elseNext: null,
});

/// A procedure that is still a list, as a flow: one action per step, in
/// order, the days between offsets as waits, and an end. Steps with no day
/// keep none. Nothing is lost: flowSteps() of the result is the list again.
export function flowFromSteps(steps: ProcessStep[]): ProcessFlow {
  const nodes: FlowNode[] = [];
  let lastDay = 0;
  steps.forEach((st, i) => {
    const node = emptyNode(`s${i + 1}`, "ACTION", st.title);
    node.step = st;
    node.owner = st.owner ?? null;
    if (st.offsetBusinessDays !== null) {
      node.waitBusinessDays = Math.max(0, st.offsetBusinessDays - lastDay);
      lastDay = Math.max(lastDay, st.offsetBusinessDays);
    }
    nodes.push(node);
  });
  const end = emptyNode("end", "END", "סיום");
  nodes.push(end);
  nodes.forEach((n, i) => {
    if (n.kind === "ACTION") n.next = nodes[i + 1]?.id ?? null;
  });
  return { v: 1, start: nodes[0]?.id ?? null, nodes };
}

/// The nodes in an order every reader can rely on: each one after every node
/// that leads to it (a topological order from the start). Null when the
/// flow loops.
export function flowOrder(flow: ProcessFlow): FlowNode[] | null {
  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  const indegree = new Map(flow.nodes.map((n) => [n.id, 0]));
  for (const n of flow.nodes) for (const t of nextOf(n)) if (t && indegree.has(t)) indegree.set(t, (indegree.get(t) ?? 0) + 1);
  const queue = flow.nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id);
  // The start first, so the order reads from the top.
  queue.sort((a, b) => (a === flow.start ? -1 : b === flow.start ? 1 : 0));
  const out: FlowNode[] = [];
  while (queue.length) {
    const nid = queue.shift()!;
    const n = byId.get(nid)!;
    out.push(n);
    for (const t of nextOf(n)) {
      if (!t || !indegree.has(t)) continue;
      indegree.set(t, (indegree.get(t) ?? 0) - 1);
      if (indegree.get(t) === 0) queue.push(t);
    }
  }
  return out.length === flow.nodes.length ? out : null;
}

/// The procedure's steps as the list every other reader knows (runs,
/// documents, checks, MCP): every action, in flow order. An action's day is
/// its earliest day from the start, along the shortest path, waits and
/// condition timeouts not counted (a branch starts when its answer comes).
/// A send-mail action is a client message on the email channel; sent on its
/// own, it is automated.
export function flowSteps(flow: ProcessFlow): ProcessStep[] {
  const order = flowOrder(flow) ?? flow.nodes;
  const day = new Map<string, number>();
  if (flow.start) day.set(flow.start, 0);
  for (const n of order) {
    const own = (day.get(n.id) ?? 0) + (n.waitBusinessDays ?? 0);
    day.set(n.id, own);
    for (const t of nextOf(n)) {
      if (!t) continue;
      const prev = day.get(t);
      if (prev === undefined || own < prev) day.set(t, own);
    }
  }
  return order
    .filter((n) => n.kind === "ACTION" && n.step)
    .map((n) => {
      const st = { ...(n.step as ProcessStep), title: n.title || (n.step as ProcessStep).title, ...(n.owner ? { owner: n.owner } : {}) };
      const hasCondition = flow.nodes.some((x) => x.kind === "CONDITION");
      const offset = hasCondition || n.waitBusinessDays !== null ? day.get(n.id) ?? null : st.offsetBusinessDays;
      if (n.send) {
        const auto = n.send.mode === "AUTO";
        return {
          ...st,
          offsetBusinessDays: offset,
          channel: "EMAIL" as const,
          actionTags: st.actionTags.includes("CLIENT_MESSAGE") ? st.actionTags : [...st.actionTags, "CLIENT_MESSAGE" as const],
          mode: auto ? ("AUTOMATED" as const) : st.mode === "AUTOMATED" ? ("ASSISTED" as const) : st.mode,
          verification: auto ? st.verification ?? SENT_MAIL_VERIFICATION : st.verification,
          // Fixed only when a person wrote the wording here; flowIssues
          // refuses an automatic mail without one.
          ...(auto && n.send.body ? { fixedMessage: true } : {}),
        };
      }
      return { ...st, offsetBusinessDays: offset };
    });
}

/// ADR 0006: an issue as a key a screen words in the reader's language
/// (clients.processes.flow.issues.<key>). `message` stays the Hebrew the
/// server and its refusals have always used. `title` is the node's own
/// title, empty when it has none: the screen names it "צומת בלי שם" in its
/// own words, and puts it in quotes otherwise, as the message does.
export type FlowIssueKey =
  | "duplicateId"
  | "noStart"
  | "missingTarget"
  | "autoNoBody"
  | "unknownParams"
  | "deadEnd"
  | "noQuestion"
  | "noBranches"
  | "noElseDays"
  | "elseDeadEnd"
  | "branchDeadEnd"
  | "branchNoMailConnection"
  | "branchNoDriveConnection"
  | "branchNoFolder"
  | "branchReplyNotMail"
  | "loop"
  | "unreachable"
  | "tooLong";
export type FlowIssue = { code: string; message: string; node?: string; keyed?: { key: FlowIssueKey; title?: string; values?: Record<string, string | number> } };

const nodeName = (n: FlowNode) => (n.title ? `"${n.title}"` : "צומת בלי שם");

/// What stops a flow from being saved as live, besides the step checks of
/// process-rules (which run on flowSteps()). Each issue names its node, so
/// the editor marks it.
export function flowIssues(flow: ProcessFlow): FlowIssue[] {
  const out: FlowIssue[] = [];
  const byId = new Map<string, FlowNode>();
  for (const n of flow.nodes) {
    if (byId.has(n.id)) out.push({ code: "F1", node: n.id, message: `שני צמתים עם אותו מזהה (${n.id}).`, keyed: { key: "duplicateId", values: { id: n.id } } });
    byId.set(n.id, n);
  }
  if (!flow.start || !byId.has(flow.start)) {
    out.push({ code: "F2", message: "לנוהל אין צומת התחלה.", keyed: { key: "noStart" } });
    return out;
  }
  for (const n of flow.nodes) {
    for (const t of nextOf(n)) {
      if (t && !byId.has(t)) out.push({ code: "F3", node: n.id, message: `${nodeName(n)} ממשיך לצומת שלא קיים.`, keyed: { key: "missingTarget", title: n.title } });
    }
    if (n.send?.mode === "AUTO" && !n.send.body) {
      out.push({ code: "F11", node: n.id, message: `${nodeName(n)} נשלח אוטומטית, ולכן צריך נוסח קבוע שאדם כתב כאן.`, keyed: { key: "autoNoBody", title: n.title } });
    }
    if (n.send?.body) {
      const { unknown } = messageParams(n.send.body);
      if (unknown.length) {
        out.push({ code: "F12", node: n.id, message: `בנוסח של ${nodeName(n)} יש פרמטר שלא קיים: ${unknown.map((u) => `{{${u}}}`).join(", ")}. אפשר: ${MESSAGE_PARAMS.join(", ")}.`,
          keyed: { key: "unknownParams", title: n.title, values: { unknown: unknown.map((u) => `{{${u}}}`).join(", "), allowed: MESSAGE_PARAMS.join(", ") } },
        });
      }
    }
    if (n.kind !== "END" && n.kind !== "CONDITION" && !n.next) {
      out.push({ code: "F4", node: n.id, message: `${nodeName(n)} לא ממשיך לשום מקום. כל מסלול מסתיים בצומת "סיום".`, keyed: { key: "deadEnd", title: n.title } });
    }
    if (n.kind === "CONDITION") {
      if (!n.question) out.push({ code: "F5", node: n.id, message: `לתנאי ${nodeName(n)} אין שאלה.`, keyed: { key: "noQuestion", title: n.title } });
      if (n.branches.length === 0) out.push({ code: "F5", node: n.id, message: `לתנאי ${nodeName(n)} אין ענפים.`, keyed: { key: "noBranches", title: n.title } });
      if (n.elseAfterBusinessDays === null) out.push({ code: "F6", node: n.id, message: `לתנאי ${nodeName(n)} חסר אחרי כמה ימים עוברים ל"אחרת".`, keyed: { key: "noElseDays", title: n.title } });
      if (!n.elseNext) out.push({ code: "F4", node: n.id, message: `ה"אחרת" של ${nodeName(n)} לא ממשיך לשום מקום.`, keyed: { key: "elseDeadEnd", title: n.title } });
      n.branches.forEach((b, i) => {
        if (!b.next) out.push({ code: "F4", node: n.id, message: `ענף ${i + 1} של ${nodeName(n)} לא ממשיך לשום מקום.`, keyed: { key: "branchDeadEnd", title: n.title, values: { n: i + 1 } } });
        if ((b.source === "EMAIL_REPLY" || b.source === "DRIVE_FILE") && !b.connectionId) {
          out.push({ code: "F7", node: n.id, message: `ענף ${i + 1} של ${nodeName(n)} בודק ${b.source === "EMAIL_REPLY" ? "מייל" : "דרייב"}, ולא נבחר חיבור.`,
            keyed: { key: b.source === "EMAIL_REPLY" ? "branchNoMailConnection" : "branchNoDriveConnection", title: n.title, values: { n: i + 1 } },
          });
        }
        if (b.source === "DRIVE_FILE" && !b.ref) out.push({ code: "F7", node: n.id, message: `ענף ${i + 1} של ${nodeName(n)}: לא נבחרה תיקייה.`, keyed: { key: "branchNoFolder", title: n.title, values: { n: i + 1 } } });
        if (b.source === "EMAIL_REPLY" && b.ref && byId.get(b.ref)?.send == null) {
          out.push({ code: "F7", node: n.id, message: `ענף ${i + 1} של ${nodeName(n)} מחכה לתשובה לצומת שלא שולח מייל.`, keyed: { key: "branchReplyNotMail", title: n.title, values: { n: i + 1 } } });
        }
      });
    }
  }
  const order = flowOrder(flow);
  if (!order) {
    out.push({ code: "F8", message: "בנוהל יש לולאה: צומת שחוזר לצומת שכבר היה. ענפים יכולים להתאחד, אבל לא לחזור אחורה.", keyed: { key: "loop" } });
    return out;
  }
  // Reachable from the start.
  const seen = new Set<string>();
  const stack = [flow.start];
  while (stack.length) {
    const nid = stack.pop()!;
    if (seen.has(nid) || !byId.has(nid)) continue;
    seen.add(nid);
    for (const t of nextOf(byId.get(nid)!)) if (t) stack.push(t);
  }
  for (const n of flow.nodes) if (!seen.has(n.id)) out.push({ code: "F9", node: n.id, message: `אי אפשר להגיע ל${nodeName(n)} מההתחלה.`, keyed: { key: "unreachable", title: n.title } });
  // The longest path stays a procedure, not several (process-rules' limit).
  const actions = new Map<string, number>();
  for (const n of order) {
    const here = (actions.get(n.id) ?? 0) + (n.kind === "ACTION" ? 1 : 0);
    actions.set(n.id, here);
    for (const t of nextOf(n)) if (t) actions.set(t, Math.max(actions.get(t) ?? 0, here));
  }
  if (Math.max(0, ...actions.values()) > MAX_PROCESS_STEPS) {
    out.push({ code: "F10", message: `במסלול אחד יש יותר מ-${MAX_PROCESS_STEPS} פעולות. נוהל ארוך מזה הוא כמה תהליכים.`, keyed: { key: "tooLong", values: { max: MAX_PROCESS_STEPS } } });
  }
  return out;
}

/// The nodes that need a second pair of eyes before a version goes live
/// (step 3 decision): mail that goes out on its own, and money moving.
export function secondEyeNodes(flow: ProcessFlow): FlowNode[] {
  return flow.nodes.filter(
    (n) => n.kind === "ACTION" && (n.send?.mode === "AUTO" || (n.step?.actionTags ?? []).some((t) => MONEY_TAGS.includes(t)))
  );
}

/// One line per node for the phone's vertical tree: a node is drawn under
/// the first node that leads to it; every later way in is shown as
/// "ממשיך ל". Depth is how many branches in it sits.
export type TreeLine =
  | { type: "node"; node: FlowNode; depth: number; branch: string | null }
  | { type: "goto"; target: FlowNode; depth: number; branch: string | null };

/// ADR 0006: how a branch with no label of its own is named on the tree.
/// The default is the Hebrew the tree has always shown; a screen passes
/// its own words.
export type FlowTreeLabels = { source: (s: BranchSource) => string; otherwise: (days: number | null) => string };

const HEBREW_TREE_LABELS: FlowTreeLabels = {
  source: (s) => BRANCH_SOURCE_LABELS[s],
  otherwise: (days) => `אחרת, אחרי ${days ?? "?"} ימים`,
};

export function flowTree(flow: ProcessFlow, labels: FlowTreeLabels = HEBREW_TREE_LABELS): TreeLine[] {
  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  const rank = new Map((flowOrder(flow) ?? flow.nodes).map((n, i) => [n.id, i]));
  const reach = (from: string | null): Set<string> => {
    const seen = new Set<string>();
    const stack = from ? [from] : [];
    while (stack.length) {
      const nid = stack.pop()!;
      if (seen.has(nid) || !byId.has(nid)) continue;
      seen.add(nid);
      for (const t of nextOf(byId.get(nid)!)) if (t) stack.push(t);
    }
    return seen;
  };
  // Where a condition's branches meet again: the earliest node every branch
  // reaches. It is drawn once, after the condition, at the condition's depth.
  const meetOf = (n: FlowNode): string | null => {
    const sets = nextOf(n).map(reach);
    if (sets.length === 0) return null;
    const common = [...sets[0]].filter((x) => sets.every((s) => s.has(x)));
    common.sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
    return common[0] ?? null;
  };
  const drawn = new Set<string>();
  const out: TreeLine[] = [];
  const walk = (nid: string | null, depth: number, branch: string | null, stopAt: string | null) => {
    let cur = nid;
    let label = branch;
    while (cur) {
      const n = byId.get(cur);
      if (!n) return;
      if (cur === stopAt || drawn.has(cur)) {
        out.push({ type: "goto", target: n, depth, branch: label });
        return;
      }
      drawn.add(cur);
      out.push({ type: "node", node: n, depth, branch: label });
      label = null;
      if (n.kind === "CONDITION") {
        const meet = meetOf(n);
        n.branches.forEach((b) => walk(b.next, depth + 1, b.label || labels.source(b.source), meet ?? stopAt));
        walk(n.elseNext, depth + 1, n.elseLabel || labels.otherwise(n.elseAfterBusinessDays), meet ?? stopAt);
        if (!meet || meet === stopAt) return;
        cur = meet;
        continue;
      }
      cur = n.kind === "END" ? null : n.next;
    }
  };
  walk(flow.start, 0, null, null);
  return out;
}
