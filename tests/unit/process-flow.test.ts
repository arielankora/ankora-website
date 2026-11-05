import { describe, expect, it } from "vitest";
import {
  flowFromSteps,
  flowIssues,
  flowOrder,
  flowSteps,
  flowTree,
  messageParams,
  readFlow,
  secondEyeNodes,
  SENT_MAIL_VERIFICATION,
  type FlowNode,
  type ProcessFlow,
} from "@/lib/process-flow";
import { blockingChecks, type ProcessStep } from "@/lib/process-rules";

// 4.11.2026 (task cmvtivumj000pjs08q9qj4t67): a procedure as a flow with
// conditions, branches that meet again, and no loops.

const step = (title: string, offsetBusinessDays: number | null = null, extra: Partial<ProcessStep> = {}): ProcessStep => ({
  title,
  mode: "MANUAL",
  offsetBusinessDays,
  actionTags: [],
  systemIds: [],
  output: null,
  verification: null,
  requiresApproval: false,
  amountMaxMinor: null,
  currency: null,
  channel: null,
  ...extra,
});

const node = (id: string, kind: FlowNode["kind"], extra: Partial<FlowNode> = {}): FlowNode => ({
  id,
  kind,
  title: id,
  waitBusinessDays: null,
  owner: null,
  position: null,
  step: kind === "ACTION" ? step(id) : null,
  send: null,
  next: null,
  question: null,
  branches: [],
  elseLabel: null,
  elseAfterBusinessDays: null,
  elseNext: null,
  ...extra,
});

// The design's example: ask for the monthly reports, then wait for a file,
// a reply, or three days; all three meet at "close".
const monthly = (): ProcessFlow => ({
  v: 1,
  start: "ask",
  nodes: [
    node("ask", "ACTION", { next: "got", send: { mode: "DRAFT", toContactId: null, toText: "כספים", body: null } }),
    node("got", "CONDITION", {
      question: "האם הדוחות הגיעו?",
      branches: [
        { id: "b1", label: "הגיע קובץ", source: "DRIVE_FILE", connectionId: "c1", ref: "folder1", next: "check" },
        { id: "b2", label: "ענה במייל", source: "EMAIL_REPLY", connectionId: "c2", ref: "ask", next: "read" },
      ],
      elseLabel: null,
      elseAfterBusinessDays: 3,
      elseNext: "remind",
    }),
    node("check", "ACTION", { next: "close" }),
    node("read", "ACTION", { next: "close" }),
    node("remind", "ACTION", { next: "close", send: { mode: "AUTO", toContactId: null, toText: "כספים", body: "תזכורת" } }),
    node("close", "ACTION", { next: "end", waitBusinessDays: 1 }),
    node("end", "END"),
  ],
});

describe("flowFromSteps", () => {
  it("turns a list into a chain and back without losing a step or a day", () => {
    const steps = [step("פתיחה", 0), step("תזכורת", 2), step("בלי יום"), step("סגירה", 5)];
    const flow = flowFromSteps(steps);
    expect(flowIssues(flow)).toEqual([]);
    expect(flow.nodes.map((n) => n.kind)).toEqual(["ACTION", "ACTION", "ACTION", "ACTION", "END"]);
    expect(flow.nodes.map((n) => n.waitBusinessDays)).toEqual([0, 2, null, 3, null]);
    expect(flowSteps(flow).map((s) => [s.title, s.offsetBusinessDays])).toEqual([
      ["פתיחה", 0],
      ["תזכורת", 2],
      ["בלי יום", null],
      ["סגירה", 5],
    ]);
  });
});

describe("flowIssues", () => {
  it("passes the design's example", () => {
    expect(flowIssues(monthly())).toEqual([]);
  });

  it("refuses a loop, but not branches that meet", () => {
    const f = monthly();
    f.nodes.find((n) => n.id === "close")!.next = "got";
    expect(flowOrder(f)).toBeNull();
    expect(flowIssues(f).map((i) => i.code)).toContain("F8");
  });

  it("asks for else's days, a connection for automatic sources, and an end for every path", () => {
    const f = monthly();
    const cond = f.nodes.find((n) => n.id === "got")!;
    cond.elseAfterBusinessDays = null;
    cond.branches[0].connectionId = null;
    f.nodes.find((n) => n.id === "read")!.next = null;
    const codes = flowIssues(f).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["F6", "F7", "F4"]));
  });

  it("refuses a reply branch that waits on a node which sends no mail", () => {
    const f = monthly();
    f.nodes.find((n) => n.id === "got")!.branches[1].ref = "check";
    expect(flowIssues(f).find((i) => i.code === "F7")?.node).toBe("got");
  });

  it("finds a node nothing leads to", () => {
    const f = monthly();
    f.nodes.push(node("lost", "ACTION", { next: "end" }));
    expect(flowIssues(f).find((i) => i.code === "F9")?.node).toBe("lost");
  });
});

describe("flowSteps", () => {
  it("lists every action once, in order, with days from the node before and mail as a client message", () => {
    const steps = flowSteps(monthly());
    expect(steps.map((s) => s.title)).toEqual(["ask", "check", "read", "remind", "close"]);
    expect(steps.find((s) => s.title === "close")?.offsetBusinessDays).toBe(1);
    const remind = steps.find((s) => s.title === "remind")!;
    expect(remind.mode).toBe("AUTOMATED");
    expect(remind.channel).toBe("EMAIL");
    expect(remind.actionTags).toContain("CLIENT_MESSAGE");
    expect(steps.find((s) => s.title === "ask")?.mode).toBe("MANUAL");
  });
});

describe("fixed messages (R1, Ariel 4.11.2026)", () => {
  it("lets a fixed wording with known parameters go out on its own, and nothing else", () => {
    const f = monthly();
    const remind = f.nodes.find((n) => n.id === "remind")!;
    remind.send!.body = "שלום {{שם איש הקשר}}, עדיין לא קיבלנו את הדוחות של {{חודש}}.";
    expect(flowIssues(f)).toEqual([]);
    const st = flowSteps(f).find((s) => s.title === "remind")!;
    expect(st.fixedMessage).toBe(true);
    expect(st.verification).toBe(SENT_MAIL_VERIFICATION);
    expect(blockingChecks({ steps: flowSteps(f) }, []).filter((c) => c.code === "R1" || c.code === "R3")).toEqual([]);

    remind.send!.body = "שלום {{כינוי}}";
    expect(flowIssues(f).find((i) => i.code === "F12")?.message).toContain("{{כינוי}}");

    remind.send!.body = null;
    expect(flowIssues(f).map((i) => i.code)).toContain("F11");
    expect(blockingChecks({ steps: flowSteps(f) }, []).some((c) => c.code === "R1")).toBe(true);
  });

  it("reads the parameters a wording uses", () => {
    expect(messageParams("{{ חודש }} ו-{{שם הלקוח}} ו-{{חודש}} ו-{{x}}")).toEqual({ used: ["חודש", "שם הלקוח"], unknown: ["x"] });
  });
});

describe("secondEyeNodes", () => {
  it("is mail that goes out on its own and money that moves", () => {
    const f = monthly();
    expect(secondEyeNodes(f).map((n) => n.id)).toEqual(["remind"]);
    f.nodes.find((n) => n.id === "check")!.step!.actionTags = ["PAYMENT"];
    expect(secondEyeNodes(f).map((n) => n.id)).toEqual(["check", "remind"]);
  });
});

describe("flowTree", () => {
  it("draws the meeting node once, after the condition, and the branches point to it", () => {
    const lines = flowTree(monthly());
    const drawn = lines.filter((l) => l.type === "node").map((l) => (l.type === "node" ? l.node.id : ""));
    expect(drawn).toEqual(["ask", "got", "check", "read", "remind", "close", "end"]);
    const gotos = lines.filter((l) => l.type === "goto");
    expect(gotos).toHaveLength(3);
    expect(gotos.every((l) => l.type === "goto" && l.target.id === "close" && l.depth === 1)).toBe(true);
    const close = lines.find((l) => l.type === "node" && l.node.id === "close");
    expect(close?.depth).toBe(0);
  });
});

describe("readFlow", () => {
  it("drops what it does not know and keeps what it does", () => {
    const back = readFlow(JSON.parse(JSON.stringify(monthly())));
    expect(back).toEqual(monthly());
    const odd = readFlow({ start: "a", nodes: [{ id: "a", kind: "TELEPORT", title: "x", next: "../etc" }, { id: "bad id!" }] });
    expect(odd?.nodes).toHaveLength(1);
    expect(odd?.nodes[0].kind).toBe("ACTION");
    expect(odd?.nodes[0].next).toBeNull();
  });
});
