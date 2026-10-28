import { beforeEach, describe, expect, it, vi } from "vitest";

// Org brain, phase 2 (14.10.2026): get_client_file.
//
// Same approach as document-tools.test.ts: the domain is mocked and what is
// under test is the tool's own decisions. The one that matters: Claude is
// always handed the "ai" version of the file, never the staff one.

const view = vi.hoisted(() => ({ buildClientFile: vi.fn() }));
const proposals = vi.hoisted(() => ({ proposeKnowledge: vi.fn() }));
const assignment = vi.hoisted(() => ({ proposeAwaitingAssignment: vi.fn() }));
const contacts = vi.hoisted(() => ({ lookupContact: vi.fn() }));
const brief = vi.hoisted(() => ({ extractionBrief: vi.fn() }));
const live = vi.hoisted(() => ({ clientBrief: vi.fn(async () => "# תקציר תיק: NUX"), clientFileChanges: vi.fn(async () => "# מה השתנה בתיק: NUX") }));
const lookup = vi.hoisted(() => ({
  lookupClient: vi.fn(),
  lookupCategory: vi.fn(),
  autoPickCategory: vi.fn(async (): Promise<unknown> => null),
  taskCategoryInfo: vi.fn(async (): Promise<unknown> => null),
  usableCategoryById: vi.fn(async (): Promise<unknown> => null),
  lookupTeamMember: vi.fn(),
  lookupAssignee: vi.fn(),
  lookupTask: vi.fn(),
  lookupTaskById: vi.fn(),
  usableCategories: vi.fn(),
  teamMembers: vi.fn(),
  canSeeOthersTime: vi.fn(() => false),
}));
const auth = vi.hoisted(() => ({ actorFromAuthInfo: vi.fn() }));

// 28.10.2026: "בלי AI" lookups need a database; nothing here is marked.
vi.mock("@/lib/app-domain/ai-exclusion-db", () => ({ aiExcludedTaskIds: vi.fn(async () => new Set()), aiExcludedClientIds: vi.fn(async () => new Set()), isTaskAiExcluded: vi.fn(async () => false), isDocumentAiExcluded: vi.fn(async () => false) }));
vi.mock("@/lib/app-domain/client-file-view", () => view);
vi.mock("@/lib/app-domain/knowledge-proposals", () => proposals);
vi.mock("@/lib/app-domain/batch-assignment", () => assignment);
vi.mock("@/lib/app-domain/client-contacts", () => contacts);
vi.mock("@/lib/app-domain/extraction-brief", () => brief);
vi.mock("@/lib/app-domain/client-file-live", () => live);
vi.mock("@/lib/app-domain/mcp-files", () => ({}));
vi.mock("@/lib/app-domain/time-entries", () => ({}));
vi.mock("@/lib/app-domain/tasks", () => ({ OPEN_STATUSES: [] }));
vi.mock("@/lib/app-domain/decisions", () => ({}));
vi.mock("@/lib/app-domain/task-plans", () => ({ PlanVersionConflictError: class extends Error {} }));
vi.mock("@/lib/mcp/lookup", () => lookup);
vi.mock("@/lib/mcp/auth", () => auth);
vi.mock("@/lib/app-domain/clients", () => ({ listAccessibleClients: vi.fn(async () => []) }));
vi.mock("@/lib/app-auth/permissions", () => ({ assertCan: vi.fn() }));
vi.mock("@/lib/email-templates", () => ({ appBaseUrl: () => "https://www.ankora.co.il" }));

import { registerAnkoraTools } from "@/lib/mcp/tools";
import { TOOL_ANNOTATIONS } from "@/lib/mcp/annotations";

type Handler = (args: unknown, ctx: unknown) => Promise<{ content: { type: string; text?: string }[]; isError?: boolean }>;

function collectTools() {
  const tools = new Map<string, { config: Record<string, unknown>; handler: Handler }>();
  registerAnkoraTools({
    registerTool: (name: string, config: Record<string, unknown>, handler: Handler) => {
      tools.set(name, { config, handler });
    },
  } as unknown as Parameters<typeof registerAnkoraTools>[0]);
  return tools;
}

const ACTOR = { id: "u-hadas", name: "הדס", role: "ANKORA_EMPLOYEE", timezone: "Asia/Jerusalem", tokenVersion: 0 };
const CTX = { http: { authInfo: { token: "verified" } } };

let tools: ReturnType<typeof collectTools>;

beforeEach(() => {
  vi.clearAllMocks();
  auth.actorFromAuthInfo.mockReturnValue(ACTOR);
  lookup.lookupClient.mockResolvedValue({ ok: true, value: { id: "c-nux", name: "NUX" } });
  view.buildClientFile.mockResolvedValue({
    clientName: "NUX",
    generatedAt: new Date("2026-10-14T09:00:00Z"),
    audience: "ai",
    sections: [{ number: "13", title: "שאלות פתוחות", empty: "אין.", items: [{ text: "מי מורשה החתימה?" }] }],
    legend: [],
  });
  tools = collectTools();
});

describe("get_client_file", () => {
  it("is registered as a read", () => {
    expect(tools.has("get_client_file")).toBe(true);
    expect(TOOL_ANNOTATIONS.get_client_file.readOnlyHint).toBe(true);
  });

  it("asks for the version without contact details and sensitive items, and returns Markdown", async () => {
    const r = await tools.get("get_client_file")!.handler({ client: "nux" }, CTX);
    expect(view.buildClientFile).toHaveBeenCalledWith(ACTOR, "c-nux", { audience: "ai" });
    expect(r.content[0].text).toContain("# תיק לקוח: NUX");
    expect(r.content[0].text).toContain("- מי מורשה החתימה?");
  });

  it("passes an unknown client back as a question, and builds nothing", async () => {
    lookup.lookupClient.mockResolvedValue({ ok: false, message: 'No client named "nx" is available to this user.' });
    const r = await tools.get("get_client_file")!.handler({ client: "nx" }, CTX);
    expect(r.content[0].text).toContain("No client named");
    expect(view.buildClientFile).not.toHaveBeenCalled();
  });
});

describe("propose_knowledge", () => {
  const call = (args: unknown) => tools.get("propose_knowledge")!.handler(args, CTX);
  const ITEM = { target: "FACT", payload: { kind: "NOTE", body: "x" } };

  beforeEach(() => {
    proposals.proposeKnowledge.mockResolvedValue({ batchId: "b1", sourceCode: "S4", proposed: 1, dropped: [], secretTaskId: null, possibleMatches: [] });
  });

  it("is a write, and says plainly that nothing is in the file yet", async () => {
    expect(TOOL_ANNOTATIONS.propose_knowledge.readOnlyHint).toBe(false);
    const r = await call({ client: "nux", newSource: { kind: "TRANSCRIPT", title: "Nextage", date: "2026-10-12", firefliesId: "ff-1" }, items: [ITEM] });
    const body = JSON.parse(r.content[0].text!);
    expect(body.sourceCode).toBe("S4");
    expect(body.next).toContain("Nothing is in the file yet");
    expect(proposals.proposeKnowledge).toHaveBeenCalledWith(
      ACTOR,
      expect.objectContaining({
        clientId: "c-nux",
        via: "MCP",
        source: expect.objectContaining({ kind: "TRANSCRIPT", externalIds: ["ff-1"], restriction: "NONE", occurredAt: new Date("2026-10-12T00:00:00Z") }),
      }),
      { indexes: [0] }
    );
  });

  it("takes a task as the source, so a mapping task can be cited (19.10.2026)", async () => {
    await call({ client: "nux", newSource: { kind: "TASK", title: "מיפוי SaaS", taskId: "t-map" }, items: [ITEM] });
    expect(proposals.proposeKnowledge).toHaveBeenCalledWith(
      ACTOR,
      expect.objectContaining({ source: expect.objectContaining({ kind: "TASK", externalIds: ["t-map"] }) }),
      { indexes: [0] }
    );
  });

  it("needs a source, and a date it can read, before anything is sent", async () => {
    expect((await call({ client: "nux", items: [ITEM] })).content[0].text).toContain("sourceCode");
    expect((await call({ client: "nux", newSource: { kind: "TRANSCRIPT", title: "x", date: "12.10.2026" }, items: [ITEM] })).content[0].text).toContain("YYYY-MM-DD");
    expect(proposals.proposeKnowledge).not.toHaveBeenCalled();
  });

  it("a meeting about several clients goes to each one's file, item by item", async () => {
    lookup.lookupClient.mockImplementation(async (_a: unknown, name: string) => ({ ok: true, value: /zest/i.test(name) ? { id: "c-zest", name: "Zest" } : { id: "c-nux", name: "NUX" } }));
    const r = await call({ client: "nux", newSource: { kind: "TRANSCRIPT", title: "Nextage", firefliesId: "ff-2" }, items: [ITEM, { ...ITEM, client: "zest" }, ITEM] });
    const body = JSON.parse(r.content[0].text!);
    expect(body.batches.map((b: { client: string }) => b.client)).toEqual(["NUX", "Zest"]);
    expect(proposals.proposeKnowledge).toHaveBeenCalledWith(ACTOR, expect.objectContaining({ clientId: "c-nux", items: [ITEM, ITEM] }), { indexes: [0, 2] });
    expect(proposals.proposeKnowledge).toHaveBeenCalledWith(ACTOR, expect.objectContaining({ clientId: "c-zest", items: [ITEM] }), { indexes: [1] });
    // A source code belongs to one register.
    proposals.proposeKnowledge.mockClear();
    expect((await call({ client: "nux", sourceCode: "S1", items: [ITEM, { ...ITEM, client: "zest" }] })).content[0].text).toContain("newSource");
    expect(proposals.proposeKnowledge).not.toHaveBeenCalled();
  });

  it("not clear whose meeting it is: it waits for a person, in no file", async () => {
    lookup.lookupClient.mockImplementation(async (_a: unknown, name: string) => ({ ok: true, value: /zest/i.test(name) ? { id: "c-zest", name: "Zest" } : { id: "c-nux", name: "NUX" } }));
    assignment.proposeAwaitingAssignment.mockResolvedValue({ batchId: "w1", waiting: 1, dropped: [], secretTaskId: null });
    const args = { client: "nux", newSource: { kind: "TRANSCRIPT", title: "Nextage", firefliesId: "ff-3" }, uncertain: { candidates: ["nux", "zest"], reason: "Justworks" }, items: [ITEM] };
    const body = JSON.parse((await call(args)).content[0].text!);
    expect(body.next).toContain("whose meeting");
    expect(assignment.proposeAwaitingAssignment).toHaveBeenCalledWith(ACTOR, expect.objectContaining({ proposedClientId: "c-nux", candidateClientIds: ["c-nux", "c-zest"], reason: "Justworks" }));
    expect(proposals.proposeKnowledge).not.toHaveBeenCalled();
    expect((await call({ ...args, newSource: undefined, sourceCode: "S1" })).content[0].text).toContain("TRANSCRIPT");
    expect((await call({ ...args, items: [{ ...ITEM, client: "zest" }] })).content[0].text).toContain("several clients");
  });

  it("there is no tool that approves", () => {
    expect([...tools.keys()].some((n) => /approve/.test(n))).toBe(false);
  });
});

describe("lookup_contact", () => {
  it("is a read, and returns what the domain allows, nothing more", async () => {
    expect(TOOL_ANNOTATIONS.lookup_contact.readOnlyHint).toBe(true);
    contacts.lookupContact.mockResolvedValue([{ name: "שני הלוי", client: "NUX", role: "VP Finance", relationship: "PROVIDER", organization: "Nextage", isPrimary: false, isDecisionMaker: false }]);
    const r = await tools.get("lookup_contact")!.handler({ query: "shani@nextage.co.il" }, CTX);
    expect(contacts.lookupContact).toHaveBeenCalledWith(ACTOR, "shani@nextage.co.il");
    expect(JSON.parse(r.content[0].text!)).toEqual({ count: 1, matches: [expect.objectContaining({ name: "שני הלוי", client: "NUX" })] });
  });
});

describe("get_extraction_brief", () => {
  it("is a read, and hands over what the domain gathered for this user", async () => {
    expect(TOOL_ANNOTATIONS.get_extraction_brief.readOnlyHint).toBe(true);
    brief.extractionBrief.mockResolvedValue({ guide: { version: 2, rules: ["x"] }, clients: [], processedRecordings: [], processedWindowDays: 30 });
    const r = await tools.get("get_extraction_brief")!.handler({}, CTX);
    expect(brief.extractionBrief).toHaveBeenCalledWith(ACTOR);
    expect(JSON.parse(r.content[0].text!).guide.version).toBe(2);
  });
});


describe("get_client_brief and get_client_changes", () => {
  it("are reads", () => {
    expect(TOOL_ANNOTATIONS.get_client_brief.readOnlyHint).toBe(true);
    expect(TOOL_ANNOTATIONS.get_client_changes.readOnlyHint).toBe(true);
  });

  it("brief: for the client the name resolves to", async () => {
    const r = await tools.get("get_client_brief")!.handler({ client: "nux" }, CTX);
    expect(live.clientBrief).toHaveBeenCalledWith(ACTOR, "c-nux");
    expect(r.content[0].text).toContain("תקציר תיק");
  });

  it("changes: a week by default, a date when given, and a bad date as a sentence", async () => {
    await tools.get("get_client_changes")!.handler({ client: "nux" }, CTX);
    const [, , since, now] = live.clientFileChanges.mock.calls[0] as unknown as [unknown, string, Date, Date];
    expect(Math.round((now.getTime() - since.getTime()) / 86_400_000)).toBe(7);
    await tools.get("get_client_changes")!.handler({ client: "nux", since: "2026-10-18" }, CTX);
    expect((live.clientFileChanges.mock.calls[1] as unknown as [unknown, string, Date])[2].toISOString()).toBe("2026-10-18T00:00:00.000Z");
    const bad = await tools.get("get_client_changes")!.handler({ client: "nux", since: "yesterday" }, CTX);
    expect(bad.content[0].text).toContain("not a date");
    expect(live.clientFileChanges).toHaveBeenCalledTimes(2);
  });
});
