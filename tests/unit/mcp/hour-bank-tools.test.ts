import { beforeEach, describe, expect, it, vi } from "vitest";

// get_hours_bank (lib/mcp/hour-bank-tools.ts). The statement itself is
// tested in tests/unit/hour-bank-statement.test.ts; here: who gets what,
// the date arguments, and that adjustments stay with managers.

const lookup = vi.hoisted(() => ({ lookupClient: vi.fn() }));
const auth = vi.hoisted(() => ({ actorFromAuthInfo: vi.fn() }));
const statement = vi.hoisted(() => ({ getHourBankStatement: vi.fn() }));

vi.mock("@/lib/mcp/lookup", () => lookup);
vi.mock("@/lib/mcp/auth", () => auth);
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/app-domain/decisions", () => ({ createDecision: vi.fn(), listDecisionsForClient: vi.fn() }));
vi.mock("@/lib/app-domain/ai-exclusion-db", () => ({
  aiExcludedTaskIds: vi.fn(async () => new Set()),
  aiExcludedClientIds: vi.fn(async () => new Set()),
  isTaskAiExcluded: vi.fn(async () => false),
  isDocumentAiExcluded: vi.fn(async () => false),
}));
vi.mock("@/lib/app-domain/hour-bank-statement", async (orig) => ({
  ...(await orig<typeof import("@/lib/app-domain/hour-bank-statement")>()),
  getHourBankStatement: statement.getHourBankStatement,
}));

import { registerHourBankTools } from "@/lib/mcp/hour-bank-tools";
import { TOOL_ANNOTATIONS } from "@/lib/mcp/annotations";
import { localDateTimeToUtc } from "@/lib/timezone";

type Handler = (args: unknown, ctx: unknown) => Promise<{ content: { type: string; text: string }[]; isError?: boolean }>;

function collect() {
  const tools = new Map<string, { config: Record<string, unknown>; handler: Handler }>();
  registerHourBankTools({
    registerTool: (name: string, config: Record<string, unknown>, handler: Handler) => tools.set(name, { config, handler }),
  } as any);
  return tools.get("get_hours_bank")!;
}

const EMPLOYEE = { id: "u-emp", name: "נועה", role: "ANKORA_EMPLOYEE", timezone: "Asia/Jerusalem" };
const ADMIN = { id: "u-adm", name: "Ariel", role: "ANKORA_ADMIN", timezone: "Asia/Jerusalem" };
const CTX = { http: { authInfo: { token: "verified" } } };
const json = (r: { content: { text: string }[] }) => JSON.parse(r.content.map((c) => c.text).join(""));

const ACTIVE = {
  id: "p2",
  kind: "PREPAID",
  loadedAt: localDateTimeToUtc("2026-10-12", "10:00"),
  validUntil: localDateTimeToUtc("2027-10-12", "00:00"),
  status: "OPEN",
  utilization: {
    purchasedMinutes: 1800,
    rolloverInMinutes: -126,
    adjustmentMinutes: 30,
    totalMinutes: 1704,
    consumedMinutes: 1500,
    remainingMinutes: 204,
    utilizationPct: 88.7,
  },
  usedMinutes: 1596,
  cardTotalMinutes: 1800,
  adjustments: [{ id: "a1", hourBankId: "p2", minutes: 30, reason: "שעה על חשבוננו", effectiveAt: localDateTimeToUtc("2026-10-20", "09:00") }],
};

let tool: ReturnType<typeof collect>;
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  lookup.lookupClient.mockResolvedValue({ ok: true, value: { id: "c-rimed", name: "RIMED" } });
  statement.getHourBankStatement.mockResolvedValue({ active: ACTIVE, previous: [], newPackageLoadedSince: true });
  tool = collect();
});

describe("get_hours_bank", () => {
  it("is read-only", () => {
    expect(tool.config.annotations).toBe(TOOL_ANNOTATIONS.get_hours_bank);
    expect(TOOL_ANNOTATIONS.get_hours_bank.readOnlyHint).toBe(true);
  });

  it("a manager gets the figures in minutes and the adjustments, flagged as internal", async () => {
    auth.actorFromAuthInfo.mockReturnValue(ADMIN);
    const out = json(await tool.handler({ client: "רימד", asOf: "2026-10-31", since: "2026-10-25" }, CTX));
    expect(out.balanceMinutes).toBe(204);
    expect(out.usedMinutes).toBe(1596);
    expect(out.consumedBillableMinutes).toBe(1500);
    expect(out.carriedInMinutes).toBe(-126);
    expect(out.activePackage).toMatchObject({ kind: "prepaid_package", sizeMinutes: 1800, loadedOn: "2026-10-12" });
    expect(out.internalOnly.doNotSendToClient).toBe(true);
    expect(out.internalOnly.adjustments).toEqual([{ minutes: 30, reason: "שעה על חשבוננו", effectiveOn: "2026-10-20" }]);
    expect(out.newPackageLoadedSince).toEqual({ since: "2026-10-25", loaded: true });
    const call = statement.getHourBankStatement.mock.calls[0];
    expect(call[0]).toBe("c-rimed");
    expect(call[1].cutoff.toISOString()).toBe(localDateTimeToUtc("2026-11-01", "00:00").toISOString());
  });

  it("an assigned employee gets the figures but not the reasons", async () => {
    auth.actorFromAuthInfo.mockReturnValue(EMPLOYEE);
    const out = json(await tool.handler({ client: "רימד" }, CTX));
    expect(out.balanceMinutes).toBe(204);
    expect(out.internalOnly.adjustments).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain("שעה על חשבוננו");
    expect(statement.getHourBankStatement.mock.calls[0][1].cutoff).toBeNull();
  });

  it("a client the user cannot reach, or one marked בלי AI, gets lookupClient's answer and no read", async () => {
    auth.actorFromAuthInfo.mockReturnValue(EMPLOYEE);
    lookup.lookupClient.mockResolvedValue({ ok: false, message: "no such client" });
    const r = await tool.handler({ client: "אחר" }, CTX);
    expect(r.content[0].text).toBe("no such client");
    expect(statement.getHourBankStatement).not.toHaveBeenCalled();
  });

  it("refuses a date that is not YYYY-MM-DD", async () => {
    auth.actorFromAuthInfo.mockReturnValue(ADMIN);
    const r = await tool.handler({ client: "רימד", asOf: "31.10.2026" }, CTX);
    expect(r.content[0].text).toContain("YYYY-MM-DD");
    expect(statement.getHourBankStatement).not.toHaveBeenCalled();
  });

  it("a client with no bank says so", async () => {
    auth.actorFromAuthInfo.mockReturnValue(ADMIN);
    statement.getHourBankStatement.mockResolvedValue({ active: null, previous: [], newPackageLoadedSince: null });
    const out = json(await tool.handler({ client: "רימד", asOf: "2026-08-01" }, CTX));
    expect(out.activePackage).toBeNull();
    expect(out.message).toContain("2026-08-01");
  });
});
