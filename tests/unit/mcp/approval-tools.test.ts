import { beforeEach, describe, expect, it, vi } from "vitest";

// "אישורים" from Claude (2.11.2026): list_approvals, decide_approval and
// decide_knowledge_proposals. The domain is mocked; under test are the
// tool surface's own decisions:
//
//   1. Every row and every proposal carries a direct link, built here,
//      that opens the screen on that very item.
//   2. A decision is taken only on a row that is waiting on the person
//      now, only with a button the row offers, and with a reason where
//      the screen asks for one. A refused call writes nothing.
//   3. A proposal the card says to approve on its own is never approved
//      together with others.

const ACTOR = { id: "u-ariel", name: "Ariel", role: "SUPER_ADMIN", timezone: "Asia/Jerusalem" };
const BASE = "https://www.ankora.co.il";

const domain = vi.hoisted(() => ({
  listApprovalsForAi: vi.fn(),
  findApprovalForAi: vi.fn(),
  decideProposalForAi: vi.fn(),
  decideAutoAppliedForAi: vi.fn(),
  proposalAloneBecause: vi.fn(async (_id: string) => null as string | null),
}));
const decide = vi.hoisted(() => ({ decideApproval: vi.fn() }));
const lookup = vi.hoisted(() => ({ lookupClient: vi.fn() }));
const auto = vi.hoisted(() => ({ listAutoReview: vi.fn(async () => [] as unknown[]) }));

vi.mock("@/lib/app-domain/mcp-approvals", () => domain);
vi.mock("@/lib/app-domain/decide-approval", () => decide);
vi.mock("@/lib/mcp/lookup", () => lookup);
vi.mock("@/lib/app-domain/auto-apply", () => auto);
vi.mock("@/lib/mcp/task-extra-tools", () => ({ actorOf: () => ACTOR }));
vi.mock("@/lib/email-templates", () => ({ appBaseUrl: () => BASE }));

import { registerApprovalTools } from "@/lib/mcp/approval-tools";
import { TOOL_ANNOTATIONS, WRITE_TOOLS } from "@/lib/mcp/annotations";

type Handler = (args: unknown, ctx: unknown) => Promise<{ content: { type: string; text: string }[] }>;
const tools = new Map<string, Handler>();
registerApprovalTools({ registerTool: (name: string, _c: unknown, h: Handler) => void tools.set(name, h) } as never);

async function call(name: string, args: unknown) {
  const r = await tools.get(name)!(args, {});
  const text = r.content.map((c) => c.text).join("");
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

const RULE = {
  kind: "rule",
  id: "pol1",
  clientId: "c-nux",
  clientName: "NUX",
  title: "Cost Plus 8%",
  since: new Date("2026-10-30T08:00:00Z"),
  href: "/app/clients/c-nux?tab=file#item-pol1",
  actions: { approve: "אישור הכלל", reject: { label: "הסרה", note: false } },
  recommend: { text: "לאשר", why: "הלקוח אמר את זה במפורש." },
};
const EXCEPTION = { ...RULE, kind: "exception", id: "ex1", href: "/app/clients/c-nux?tab=file#item-pol1", actions: { approve: "אישור החריגה", reject: { label: "דחייה", note: true } } };
const PROCEDURE = { ...RULE, kind: "procedure", id: "p1", version: 3, actions: { approve: null, reject: null }, blocked: "הנוהל לא עובר את הבדיקות." };
const BATCH = { ...RULE, kind: "knowledge", id: "b52", title: "2 הצעות לתיק", href: "/app/approvals?tab=knowledge&clientId=c-nux", actions: { approve: null, reject: null } };
const PROPOSAL = { id: "pr1", batchId: "b52", clientId: "c-nux", kind: "כספים", action: "SUPERSEDE", headline: "החלטה רשמית של אורן", reason: null, quote: null, flags: [], aloneBecause: "משנה פריט שכבר בתיק", alreadyInFile: null, hiddenFor: null };

beforeEach(() => {
  vi.clearAllMocks();
  lookup.lookupClient.mockResolvedValue({ ok: true, value: { id: "c-nux", name: "NUX" } });
  domain.proposalAloneBecause.mockResolvedValue(null);
  auto.listAutoReview.mockResolvedValue([]);
});

describe("list_approvals", () => {
  it("a blocked procedure lists the checks it fails (`failing`), and other rows carry none", async () => {
    const failing = ["שלבים 1 ו-4 אוטומטיים: צריך לכתוב בכל אחד איך אדם מוודא שהשלב קרה.", "שלב 2: הודעה ללקוח עוברת בדיקה של אדם לפני שהיא יוצאת, ולכן לא נשלחת אוטומטית."];
    domain.listApprovalsForAi.mockResolvedValue({ items: [{ ...PROCEDURE, failing }, RULE], proposals: new Map() });
    const out = await call("list_approvals", {});
    const proc = out.approvals.find((a: { kind: string }) => a.kind === "procedure");
    expect(proc.blocked).toContain("הנוהל לא עובר את הבדיקות");
    expect(proc.failing).toEqual(failing);
    expect(out.approvals.find((a: { kind: string }) => a.kind === "rule").failing).toBeUndefined();
  });

  it("gives every row and every proposal a direct link", async () => {
    domain.listApprovalsForAi.mockResolvedValue({ items: [RULE, BATCH], proposals: new Map([["b52", [PROPOSAL]]]) });
    const out = await call("list_approvals", {});
    expect(out.count).toBe(2);
    const rule = out.approvals.find((a: { kind: string }) => a.kind === "rule");
    expect(rule.url).toBe(`${BASE}/app/approvals?tab=rule&clientId=c-nux#approval-rule-pol1`);
    expect(rule.openItem).toBe(`${BASE}/app/clients/c-nux?tab=file#item-pol1`);
    expect(rule.approve).toBe("אישור הכלל");
    const batch = out.approvals.find((a: { kind: string }) => a.kind === "knowledge");
    expect(batch.url).toBe(`${BASE}/app/approvals?tab=knowledge&clientId=c-nux#batch-b52`);
    // The batch's own card, not the tab.
    expect(batch.openItem).toBe(batch.url);
    expect(batch.approve).toBeNull();
    expect(batch.reject).toBeNull();
    expect(rule.reject).toEqual({ label: "הסרה", needsReason: false });
    expect(batch.proposals[0]).toMatchObject({ proposalId: "pr1", approveAlone: "משנה פריט שכבר בתיק", url: `${BASE}/app/approvals?tab=knowledge&clientId=c-nux#proposal-pr1` });
  });

  it("lists what entered a file on its own and waits for a look, with links, only for knowledge (3.11.2026)", async () => {
    domain.listApprovalsForAi.mockResolvedValue({ items: [], proposals: new Map() });
    auto.listAutoReview.mockResolvedValue([
      { id: "pa1", clientId: "c-nux", clientName: "NUX", target: "FACT", kindLabel: "העדפה", headline: "מייל ולא טלפון", resultId: "f1", decidedAt: new Date("2026-11-03T10:00:00Z"), why: "מדגם של 20%", revertible: true },
      { id: "pa2", clientId: "c-nux", clientName: "NUX", target: "FACT", kindLabel: "הערה", headline: "בלי ביטול", resultId: null, decidedAt: new Date("2026-11-03T10:00:00Z"), why: "מדגם של 20%", revertible: false },
    ]);
    const out = await call("list_approvals", {});
    expect(auto.listAutoReview).toHaveBeenCalledWith(ACTOR, { clientId: null, forAi: true });
    expect(out.enteredAutomatically).toEqual([
      {
        proposalId: "pa1",
        client: "NUX",
        kind: "העדפה",
        says: "מייל ולא טלפון",
        enteredOn: "2026-11-03",
        why: "מדגם של 20%",
        url: `${BASE}/app/approvals?tab=knowledge&clientId=c-nux#auto-pa1`,
        result: `${BASE}/app/clients/c-nux?tab=file#item-f1`,
        decisions: ["reviewed_ok", "revert"],
      },
      expect.objectContaining({ proposalId: "pa2", decisions: ["reviewed_ok"] }),
    ]);
    auto.listAutoReview.mockClear();
    const rules = await call("list_approvals", { kind: "rule" });
    expect(auto.listAutoReview).not.toHaveBeenCalled();
    expect(rules.enteredAutomatically).toBeUndefined();
  });

  it("says who decides a sensitive proposal, in Hebrew", async () => {
    domain.listApprovalsForAi.mockResolvedValue({ items: [BATCH], proposals: new Map([["b52", [{ ...PROPOSAL, hiddenFor: "אורן" }]]]) });
    const out = await call("list_approvals", {});
    expect(out.approvals[0].proposals[0].hidden).toBe("פריט רגיש. רק אורן רואה אותו ומחליט עליו.");
    expect(out.approvals[0].proposals[0].says).toBeUndefined();
  });

  it("narrows to a named client, and stops on a name it cannot match", async () => {
    domain.listApprovalsForAi.mockResolvedValue({ items: [], proposals: new Map() });
    await call("list_approvals", { client: "nux", kind: "rule" });
    expect(domain.listApprovalsForAi).toHaveBeenCalledWith(ACTOR, { clientId: "c-nux", kind: "rule", everyone: false });

    lookup.lookupClient.mockResolvedValue({ ok: false, message: "No client matches." });
    const out = await call("list_approvals", { client: "zzz" });
    expect(out.text).toContain("No client matches");
  });
});

describe("decide_approval", () => {
  it("decides a row that is waiting, through the shared domain function", async () => {
    domain.findApprovalForAi.mockResolvedValue(RULE);
    const out = await call("decide_approval", { kind: "rule", id: "pol1", decision: "approve" });
    expect(decide.decideApproval).toHaveBeenCalledWith(ACTOR, expect.objectContaining({ kind: "rule", id: "pol1", decision: "approve", clientId: "c-nux" }));
    expect(out).toMatchObject({ done: true, did: "אישור הכלל", url: `${BASE}/app/clients/c-nux?tab=file#item-pol1` });
  });

  it("passes the version a procedure is decided by, from the row", async () => {
    domain.findApprovalForAi.mockResolvedValue({ ...PROCEDURE, actions: { approve: "אישור הנוהל", reject: null }, blocked: null });
    await call("decide_approval", { kind: "procedure", id: "p1", decision: "approve" });
    expect(decide.decideApproval.mock.calls[0][1].version).toBe(3);
  });

  it("writes nothing for a row no longer waiting", async () => {
    domain.findApprovalForAi.mockResolvedValue(null);
    const out = await call("decide_approval", { kind: "rule", id: "gone", decision: "approve" });
    expect(out.text).toContain("No row with this kind and id is waiting on you");
    expect(decide.decideApproval).not.toHaveBeenCalled();
  });

  it("writes nothing for a decision the row does not offer", async () => {
    domain.findApprovalForAi.mockResolvedValue(PROCEDURE);
    const out = await call("decide_approval", { kind: "procedure", id: "p1", decision: "approve" });
    expect(out.text).toContain("הנוהל לא עובר את הבדיקות");
    expect(decide.decideApproval).not.toHaveBeenCalled();
  });

  it("asks for the reason where the screen asks for one", async () => {
    domain.findApprovalForAi.mockResolvedValue(EXCEPTION);
    const out = await call("decide_approval", { kind: "exception", id: "ex1", decision: "reject" });
    expect(out.text).toContain("reason");
    expect(decide.decideApproval).not.toHaveBeenCalled();

    await call("decide_approval", { kind: "exception", id: "ex1", decision: "reject", reason: "S52 כבר מכסה" });
    expect(decide.decideApproval.mock.calls[0][1]).toMatchObject({ decision: "reject", note: "S52 כבר מכסה" });
  });

  it("sends proposals to their own tool", async () => {
    const out = await call("decide_approval", { kind: "knowledge", id: "b52", decision: "approve" });
    expect(out.text).toContain("decide_knowledge_proposals");
    expect(domain.findApprovalForAi).not.toHaveBeenCalled();
  });
});

describe("decide_knowledge_proposals", () => {
  it("decides each proposal and links to its batch", async () => {
    domain.decideProposalForAi.mockImplementation(async (_a: unknown, id: string) => ({ clientId: "c-nux", batchId: "b51", headline: `h-${id}`, taskId: null, resultId: null }));
    const out = await call("decide_knowledge_proposals", { proposalIds: ["a", "b"], decision: "reject", reason: "כבר כלולה ב-S52" });
    expect(domain.decideProposalForAi).toHaveBeenCalledTimes(2);
    expect(domain.decideProposalForAi).toHaveBeenCalledWith(ACTOR, "a", "reject", "כבר כלולה ב-S52");
    expect(out.done).toBe(2);
    expect(out.results[0].url).toBe(`${BASE}/app/approvals?tab=knowledge&clientId=c-nux#proposal-a`);
    expect(out.results[0].result).toBeUndefined();
  });

  it("refuses a reject without a reason, writing nothing", async () => {
    const out = await call("decide_knowledge_proposals", { proposalIds: ["a"], decision: "reject" });
    expect(out.text).toContain("reason");
    expect(domain.decideProposalForAi).not.toHaveBeenCalled();
  });

  it("approves a one-by-one proposal only in a call of its own", async () => {
    domain.proposalAloneBecause.mockImplementation(async (id: string) => (id === "change" ? "משנה פריט שכבר בתיק" : null));
    domain.decideProposalForAi.mockResolvedValue({ clientId: "c-nux", batchId: "b52", headline: "h", taskId: null, resultId: null });
    const out = await call("decide_knowledge_proposals", { proposalIds: ["new", "change"], decision: "approve" });
    expect(out.done).toBe(1);
    expect(out.errors[0]).toMatchObject({ proposalId: "change" });
    expect(domain.decideProposalForAi).toHaveBeenCalledTimes(1);

    await call("decide_knowledge_proposals", { proposalIds: ["change"], decision: "approve" });
    expect(domain.decideProposalForAi).toHaveBeenLastCalledWith(ACTOR, "change", "approve", null);
  });

  it("reports a failure and goes on with the rest", async () => {
    domain.decideProposalForAi.mockRejectedValueOnce(new Error("אין הרשאה")).mockResolvedValueOnce({ clientId: "c-nux", batchId: "b52", headline: "h", taskId: "t9", resultId: null });
    const out = await call("decide_knowledge_proposals", { proposalIds: ["x", "y"], decision: "task" });
    expect(out.failed).toBe(1);
    expect(out.results[0].task).toBe(`${BASE}/app/tasks/t9`);
  });
});

describe("decide_knowledge_proposals on what entered automatically (3.11.2026)", () => {
  it("reviewed_ok and revert go to their own domain function, with the row and the item", async () => {
    domain.decideAutoAppliedForAi.mockResolvedValue({ clientId: "c-nux", headline: "מייל ולא טלפון", resultId: "f1" });
    const ok = await call("decide_knowledge_proposals", { proposalIds: ["pa1"], decision: "reviewed_ok" });
    expect(domain.decideAutoAppliedForAi).toHaveBeenCalledWith(ACTOR, "pa1", "reviewed_ok");
    expect(domain.decideProposalForAi).not.toHaveBeenCalled();
    expect(ok.results[0]).toEqual({ proposalId: "pa1", says: "מייל ולא טלפון", url: `${BASE}/app/approvals?tab=knowledge&clientId=c-nux#auto-pa1`, result: `${BASE}/app/clients/c-nux?tab=file#item-f1` });

    const out = await call("decide_knowledge_proposals", { proposalIds: ["pa1", "pa2"], decision: "revert" });
    expect(domain.decideAutoAppliedForAi).toHaveBeenLastCalledWith(ACTOR, "pa2", "revert");
    expect(out.done).toBe(2);
    expect(domain.proposalAloneBecause).not.toHaveBeenCalled();
  });

  it("reports one that is refused and goes on", async () => {
    domain.decideAutoAppliedForAi.mockRejectedValueOnce(new Error("This proposal did not enter the file automatically")).mockResolvedValueOnce({ clientId: "c-nux", headline: "h", resultId: null });
    const out = await call("decide_knowledge_proposals", { proposalIds: ["manual", "pa1"], decision: "reviewed_ok" });
    expect(out.failed).toBe(1);
    expect(out.errors[0]).toMatchObject({ proposalId: "manual", error: expect.stringContaining("automatically") });
    expect(out.results[0].result).toBeUndefined();
  });
});

describe("where a decided proposal landed", () => {
  it("links to the item in the client's file", async () => {
    domain.decideProposalForAi.mockResolvedValue({ clientId: "c-nux", batchId: "b52", headline: "h", taskId: null, resultId: "fact9" });
    const out = await call("decide_knowledge_proposals", { proposalIds: ["p1"], decision: "approve" });
    expect(out.results[0].result).toBe(`${BASE}/app/clients/c-nux?tab=file#item-fact9`);
  });
});

describe("annotations", () => {
  it("marks the list a read and the decisions writes", () => {
    expect(TOOL_ANNOTATIONS.list_approvals.readOnlyHint).toBe(true);
    expect(WRITE_TOOLS).toContain("decide_approval");
    expect(WRITE_TOOLS).toContain("decide_knowledge_proposals");
  });
});
