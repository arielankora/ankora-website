import { beforeEach, describe, expect, it, vi } from "vitest";

// Org brain, phase 2 (14.10.2026): get_client_file.
//
// Same approach as document-tools.test.ts: the domain is mocked and what is
// under test is the tool's own decisions. The one that matters: Claude is
// always handed the "ai" version of the file, never the staff one.

const view = vi.hoisted(() => ({ buildClientFile: vi.fn() }));
const lookup = vi.hoisted(() => ({
  lookupClient: vi.fn(),
  lookupCategory: vi.fn(),
  lookupTeamMember: vi.fn(),
  lookupAssignee: vi.fn(),
  lookupTask: vi.fn(),
  lookupTaskById: vi.fn(),
  usableCategories: vi.fn(),
  teamMembers: vi.fn(),
  canSeeOthersTime: vi.fn(() => false),
}));
const auth = vi.hoisted(() => ({ actorFromAuthInfo: vi.fn() }));

vi.mock("@/lib/app-domain/client-file-view", () => view);
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
