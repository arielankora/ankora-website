import { beforeEach, describe, expect, it, vi } from "vitest";

// get_proposal_stats (3.11.2026): how proposals to client files ended, to
// measure which kinds could skip a person. Under test:
//
//   1. Managers only.
//   2. Metadata only: no payload, reason, quote or rejection reason in the
//      result, and clients as opaque keys.
//   3. A "בלי AI" client's proposals are left out and only counted.
//   4. The outcome of each proposal lands in exactly one bucket, and a
//      bulk decision is read from its audit row.
//   5. The approval tiers (3.11.2026): whether the server approved it,
//      whether it was taken back, and whether a date opens a task.
//   6. Part 2: whether a person marked it right after, the switch, and the
//      pauses, with a paused client as its opaque key.

const prisma = vi.hoisted(() => ({
  knowledgeProposal: { findMany: vi.fn(), count: vi.fn() },
  extractionGuide: { findMany: vi.fn() },
  clientSource: { findMany: vi.fn() },
  auditEvent: { findMany: vi.fn() },
  appSetting: { findUnique: vi.fn(), upsert: vi.fn() },
  autoApplyPause: { findMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma }));

import { proposalStatsForAi } from "@/lib/app-domain/proposal-stats";

const MANAGER = { id: "u1", role: "SUPER_ADMIN" } as never;
const STAFF = { id: "u2", role: "ANKORA_EMPLOYEE" } as never;

const base = {
  confidence: "HIGH",
  flags: [],
  edited: false,
  attached: false,
  autoApplied: false,
  revertedAt: null,
  autoReviewedAt: null,
  decidedAt: new Date("2026-10-20T12:00:00Z"),
  createdAt: new Date("2026-10-20T10:00:00Z"),
  batch: { via: "MCP", sourceId: "s1" },
};
const SECRET_TEXT = "Guy is leaving in December";
const ROWS = [
  { ...base, id: "p1", clientId: "c-nux", target: "CONTACT", action: "CREATE", state: "APPROVED", payload: { name: SECRET_TEXT, knowledgeStatus: "CONFIRMED" } },
  { ...base, id: "p2", clientId: "c-nux", target: "CONTACT", action: "CREATE", state: "APPROVED", edited: true, payload: { name: "x" } },
  { ...base, id: "p3", clientId: "c-rimed", target: "CONTACT", action: "CREATE", state: "REJECTED", payload: { name: "y" } },
  { ...base, id: "p4", clientId: "c-rimed", target: "POLICY", action: "SUPERSEDE", state: "APPROVED", attached: true, payload: { doNotDisclose: "employees", sensitivity: "SENSITIVE" } },
  { ...base, id: "p5", clientId: "c-nux", target: "TASK", action: "CREATE", state: "TASK", payload: {} },
  { ...base, id: "p6", clientId: "c-nux", target: "CONTACT", action: "CREATE", state: "PENDING", decidedAt: null, payload: {} },
];

beforeEach(() => {
  vi.clearAllMocks();
  prisma.knowledgeProposal.findMany.mockResolvedValue(ROWS);
  prisma.knowledgeProposal.count.mockResolvedValue(3);
  prisma.extractionGuide.findMany.mockResolvedValue([{ version: 1, decidedAt: new Date("2026-10-15T00:00:00Z"), createdAt: new Date("2026-10-14T00:00:00Z") }]);
  prisma.clientSource.findMany.mockResolvedValue([{ id: "s1", kind: "TRANSCRIPT", restriction: "NONE" }]);
  prisma.auditEvent.findMany.mockResolvedValue([{ entityId: "p1", afterJson: { bulk: true } }]);
  prisma.appSetting.findUnique.mockResolvedValue({ key: "knowledge.auto_apply", value: { enabled: true, firstEnabledAt: "2026-11-03T12:00:00.000Z" } });
  prisma.autoApplyPause.findMany.mockResolvedValue([]);
});

describe("proposalStatsForAi", () => {
  it("refuses anyone who does not manage clients", async () => {
    await expect(proposalStatsForAi(STAFF)).rejects.toThrow("רק למנהלים");
    expect(prisma.knowledgeProposal.findMany).not.toHaveBeenCalled();
  });

  it("leaves out marked clients and only counts them", async () => {
    const out = await proposalStatsForAi(MANAGER);
    expect(prisma.knowledgeProposal.findMany.mock.calls[0][0].where.batch.client).toEqual({ aiExcluded: false });
    expect(prisma.knowledgeProposal.count.mock.calls[0][0].where.batch.client).toEqual({ aiExcluded: true });
    expect(out.leftOutAiExcluded).toBe(3);
  });

  it("puts every outcome in one bucket, and reads bulk from the audit row", async () => {
    const out = await proposalStatsForAi(MANAGER);
    const contact = out.groups.find((g) => g.kind === "CONTACT" && g.action === "CREATE")!;
    expect(contact).toMatchObject({ total: 4, approvedAsIs: 1, approvedEdited: 1, rejected: 1, pending: 1, approvedInBulk: 1 });
    expect(out.groups.find((g) => g.kind === "POLICY")).toMatchObject({ alreadyInFile: 1, approvedAsIs: 0 });
    expect(out.groups.find((g) => g.kind === "TASK")).toMatchObject({ toTask: 1 });
    expect(out.total).toBe(6);
    expect(out.guideVersions).toEqual([{ version: 1, approvedAt: "2026-10-15T00:00:00.000Z" }]);
  });

  it("returns metadata only, with clients as opaque keys", async () => {
    const out = await proposalStatsForAi(MANAGER, { rows: true });
    const text = JSON.stringify(out);
    expect(text).not.toContain(SECRET_TEXT);
    expect(text).not.toContain("c-nux");
    expect(text).not.toContain("employees");
    expect(out.clients).toBe(2);
    const p4 = out.rows!.find((r) => r.id === "p4")!;
    expect(p4).toMatchObject({ client: "L2", sensitive: true, doNotDisclose: true, sourceKind: "TRANSCRIPT", aloneBecause: "משנה פריט שכבר בתיק" });
    expect(out.rows!.find((r) => r.id === "p1")).toMatchObject({ bulk: true, hoursToDecision: 2 });
  });

  it("says whether the server approved it, whether it was taken back, and for a date only, whether it opens a task", async () => {
    prisma.knowledgeProposal.findMany.mockResolvedValue([
      { ...base, id: "a1", clientId: "c-nux", target: "FACT", action: "CREATE", state: "APPROVED", autoApplied: true, revertedAt: new Date("2026-10-21T08:00:00Z"), payload: { kind: "NOTE", body: SECRET_TEXT } },
      { ...base, id: "d1", clientId: "c-nux", target: "DATE", action: "CREATE", state: "APPROVED", payload: { title: SECRET_TEXT, taskDaysBefore: 0 } },
      { ...base, id: "d2", clientId: "c-nux", target: "DATE", action: "CREATE", state: "PENDING", decidedAt: null, payload: { title: "y", taskDaysBefore: null } },
    ]);
    const out = await proposalStatsForAi(MANAGER, { rows: true });
    const [a1, d1, d2] = out.rows!;
    expect(a1).toMatchObject({ autoApplied: true, reverted: true });
    expect(a1).not.toHaveProperty("autoTask");
    expect(d1).toMatchObject({ autoApplied: false, reverted: false, autoTask: true });
    expect(d2).toMatchObject({ autoTask: false });
    expect(JSON.stringify(out)).not.toContain(SECRET_TEXT);
    expect(prisma.knowledgeProposal.findMany.mock.calls[0][0].select).toMatchObject({ autoApplied: true, revertedAt: true });
  });

  it("reads why one waits with the review level: a task and a low level are approved one at a time", async () => {
    prisma.knowledgeProposal.findMany.mockResolvedValue([
      { ...base, id: "t1", clientId: "c-nux", target: "TASK", action: "CREATE", state: "PENDING", decidedAt: null, payload: { title: "x", sources: [{ code: "S1", at: "01:00" }] } },
      // A recording with no minute: HIGH is read one lower, and LOW lower still.
      { ...base, id: "l1", clientId: "c-nux", target: "FACT", action: "CREATE", state: "PENDING", decidedAt: null, confidence: "MEDIUM", payload: { kind: "NOTE" } },
    ]);
    const out = await proposalStatsForAi(MANAGER, { rows: true });
    expect(out.rows!.map((r) => [r.id, r.reviewLevel, r.aloneBecause])).toEqual([
      ["t1", "HIGH", "משימה נפתחת לאדם אחר"],
      ["l1", "LOW", "רמת בדיקה נמוכה"],
    ]);
  });

  it("says whether a person marked an auto-applied item right, the switch, and the pauses by key", async () => {
    prisma.knowledgeProposal.findMany.mockResolvedValue([
      { ...base, id: "a1", clientId: "c-nux", target: "FACT", action: "CREATE", state: "APPROVED", autoApplied: true, autoReviewedAt: new Date("2026-10-21T08:00:00Z"), payload: { kind: "NOTE" } },
      { ...base, id: "a2", clientId: "c-nux", target: "CONTACT", action: "CREATE", state: "APPROVED", autoApplied: true, payload: {} },
    ]);
    prisma.autoApplyPause.findMany.mockResolvedValue([
      { id: "z1", scope: "KIND", key: "FACT.NOTE", errors: 3, reason: "r", createdAt: new Date("2026-11-01T00:00:00Z"), liftedAt: null },
      { id: "z2", scope: "CLIENT", key: "c-rimed", errors: 2, reason: "r", createdAt: new Date("2026-11-02T00:00:00Z"), liftedAt: null },
    ]);
    const out = await proposalStatsForAi(MANAGER, { rows: true });
    expect(out.rows!.map((r) => [r.id, r.autoReviewed])).toEqual([
      ["a1", true],
      ["a2", false],
    ]);
    expect(out.autoApply).toEqual({
      enabled: true,
      firstEnabledAt: "2026-11-03T12:00:00.000Z",
      pauses: [
        { scope: "KIND", key: "FACT.NOTE", errors: 3, since: "2026-11-01T00:00:00.000Z" },
        { scope: "CLIENT", key: "L2", errors: 2, since: "2026-11-02T00:00:00.000Z" },
      ],
    });
    expect(JSON.stringify(out)).not.toContain("c-rimed");
  });

  it("names the edited fields and the kind of the edit, never their values", async () => {
    prisma.knowledgeProposal.findMany.mockResolvedValue([
      { ...base, id: "e1", clientId: "c-nux", target: "CONTACT", action: "CREATE", state: "APPROVED", edited: true, editedFields: ["role"], payload: { name: "x", role: SECRET_TEXT } },
      { ...base, id: "e2", clientId: "c-nux", target: "FACT", action: "CREATE", state: "APPROVED", edited: true, editedFields: ["body", "date"], payload: { kind: "NOTE", body: "y" } },
      // Approved with an edit before editedFields existed: no fields, no kind.
      { ...base, id: "e3", clientId: "c-nux", target: "FACT", action: "CREATE", state: "APPROVED", edited: true, payload: { kind: "NOTE" } },
      { ...base, id: "e4", clientId: "c-nux", target: "FACT", action: "CREATE", state: "APPROVED", editedFields: [], payload: { kind: "NOTE" } },
    ]);
    prisma.auditEvent.findMany.mockResolvedValue([
      { entityId: "e1", afterJson: { edited: true, editedFields: ["role"], editKind: "FACT", fields: { role: SECRET_TEXT } } },
      { entityId: "e2", afterJson: { edited: true, editedFields: ["body", "date"], editKind: "MIXED" } },
      { entityId: "e4", afterJson: { edited: false } },
    ]);
    const out = await proposalStatsForAi(MANAGER, { rows: true });
    const byId = Object.fromEntries(out.rows!.map((r) => [r.id, r]));
    expect(byId.e1).toMatchObject({ edited: true, editedFields: ["role"], editKind: "FACT" });
    expect(byId.e2).toMatchObject({ editedFields: ["body", "date"], editKind: "MIXED" });
    expect(byId.e3).toMatchObject({ edited: true, editedFields: [], editKind: null });
    expect(byId.e4).toMatchObject({ edited: false, editedFields: [], editKind: null });
    expect(JSON.stringify(out)).not.toContain(SECRET_TEXT);
    expect(prisma.knowledgeProposal.findMany.mock.calls[0][0].select).toMatchObject({ editedFields: true });
  });

  it("pages the rows", async () => {
    const out = await proposalStatsForAi(MANAGER, { rows: true, limit: 4 });
    expect(out.rows).toHaveLength(4);
    expect(out.nextOffset).toBe(4);
    const next = await proposalStatsForAi(MANAGER, { rows: true, limit: 4, offset: 4 });
    expect(next.rows).toHaveLength(2);
    expect(next.nextOffset).toBeUndefined();
  });

  it("filters by day and by who sent it", async () => {
    await proposalStatsForAi(MANAGER, { since: new Date("2026-10-01T00:00:00Z"), via: "MCP" });
    const where = prisma.knowledgeProposal.findMany.mock.calls[0][0].where;
    expect(where.createdAt).toEqual({ gte: new Date("2026-10-01T00:00:00Z") });
    expect(where.batch).toEqual({ via: "MCP", client: { aiExcluded: false } });
  });
});
