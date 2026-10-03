import { describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "./setup";
import { createTestClient, createTestClientUser, createTestUser } from "./factories";

// The two MCP surfaces against a real database (NUX handover, 3.10.2026).
//
// tests/unit/mcp/* check each tool's own decisions with the domain
// mocked. This file checks the thing a mock cannot: that a project set
// up through the STAFF connector reads back through the CLIENT
// connector exactly as the portal would show it - visible tasks only,
// in the client's words, for that client only - and that a decision
// asked on one side is answered on the other.

// The tools read the acting user from the verified token. Here the
// "token" is the user itself, so each call says who is acting.
vi.mock("@/lib/mcp/auth", () => ({
  actorFromAuthInfo: (authInfo: { extra: { user: User } }) => authInfo.extra.user,
}));

import { registerAnkoraTools } from "@/lib/mcp/tools";
import { registerPortalTools } from "@/lib/mcp/portal-tools";

type Handler = (args: unknown, ctx: unknown) => Promise<{ content: { text: string }[] }>;

function collect(register: (server: never) => void) {
  const tools = new Map<string, Handler>();
  register({
    registerTool: (name: string, _config: unknown, handler: Handler) => tools.set(name, handler),
  } as never);
  return tools;
}

const staff = collect(registerAnkoraTools as never);
const portal = collect(registerPortalTools as never);

async function as(user: User, tools: Map<string, Handler>, name: string, args: unknown = {}) {
  const result = await tools.get(name)!(args, { http: { authInfo: { extra: { user } } } });
  const text = result.content.map((c) => c.text).join("");
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

async function setup() {
  const nux = await createTestClient({ name: `NUX ${Date.now()}` });
  const other = await createTestClient({ name: `Other ${Date.now()}` });
  const { user: ariel } = await createTestUser({ role: "ANKORA_ADMIN" });
  const { user: hadas } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  await prisma.userClientAccess.createMany({
    data: [
      { userId: ariel.id, clientId: nux.id },
      { userId: ariel.id, clientId: other.id },
      { userId: hadas.id, clientId: nux.id },
    ],
  });
  const { user: oren } = await createTestClientUser({ clientId: nux.id, role: "ADMIN" });
  const { user: guy } = await createTestClientUser({ clientId: nux.id, role: "VIEWER" });
  return { nux, other, ariel, hadas, oren, guy };
}

describe("a handover set up by staff, read by the client", () => {
  it("shows the client its visible tasks only, in its own words, with steps kept internal", async () => {
    const { nux, other, ariel, hadas, oren } = await setup();

    const created = await as(ariel, staff, "create_task", {
      client: nux.name,
      title: "HND-001 התאמת עסקאות אשראי ובנק",
      assignTo: hadas.email,
      supervisor: ariel.email,
      requireApproval: true,
      clientVisible: true,
      clientTitle: "התאמות אשראי ובנק",
      steps: ["היקף וטריגר", "נוהל", "ביצוע עצמאי"],
    });
    expect(created.created).toBe(true);
    expect(created.steps).toHaveLength(3);

    await as(ariel, staff, "create_task", { client: nux.name, title: "הערה פנימית בלבד" });
    await as(ariel, staff, "create_task", { client: other.name, title: "משימה של לקוח אחר", clientVisible: true });

    const step = await as(hadas, staff, "set_task_step", { task: "HND-001", step: "נוהל", done: true });
    expect(step.stepsDone).toBe(1);

    const detail = await as(ariel, staff, "get_task", { task: "HND-001" });
    expect(detail.stepsTotal).toBe(3);
    expect(detail.supervisor).toBe(ariel.name);

    const status = await as(oren, portal, "get_status");
    expect(status.progress.total).toBe(1);
    const titles = [...status.inProgress, ...status.waitingForYou, ...status.recentlyDone].map(
      (p: { title: string }) => p.title
    );
    expect(titles).toEqual(["התאמות אשראי ובנק"]);

    const list = await as(oren, portal, "list_tasks");
    expect(list.tasks.map((t: { title: string }) => t.title)).toEqual(["התאמות אשראי ובנק"]);
  });

  it("puts a task waiting on the client in the client's 'waiting for you'", async () => {
    const { nux, ariel, oren } = await setup();
    await as(ariel, staff, "create_task", { client: nux.name, title: "ספי אישור", clientVisible: true });
    await as(ariel, staff, "update_task", { task: "ספי אישור", client: nux.name, waitingOn: "CLIENT", waitingReason: "אורן" });

    const status = await as(oren, portal, "get_status");
    expect(status.waitingForYou.map((p: { title: string }) => p.title)).toEqual(["ספי אישור"]);
    expect(status.progress.waitingForYou).toBe(1);
  });
});

describe("a decision asked by staff and answered by the client", () => {
  it("is answered by the admin, refused to the viewer, and releases the task", async () => {
    const { nux, ariel, oren, guy } = await setup();
    await as(ariel, staff, "create_task", { client: nux.name, title: "ספי אישור תוכנה", clientVisible: true });

    const asked = await as(ariel, staff, "create_decision", {
      client: nux.name,
      question: "מה סף האישור לרכישת תוכנה?",
      options: [
        { label: "3,000 דולר בשנה", recommended: true },
        { label: "5,000 דולר בשנה" },
      ],
      task: "ספי אישור תוכנה",
      markTaskWaiting: true,
    });
    expect(asked.taskMarkedWaitingOnClient).toBe(true);

    const viewer = await as(guy, portal, "answer_decision", { decision: "סף האישור", option: "3,000" });
    expect(viewer.text).toContain("admin");

    const open = await as(oren, portal, "list_decisions");
    expect(open.open).toHaveLength(1);

    const answered = await as(oren, portal, "answer_decision", { decision: "סף האישור", option: "3,000" });
    expect(answered.answered).toBe(true);

    const status = await as(oren, portal, "get_status");
    expect(status.decisionsWaitingForYou).toBe(0);
    expect(status.waitingForYou).toHaveLength(0);

    const staffView = await as(ariel, staff, "list_decisions", { client: nux.name, includeClosed: true });
    expect(staffView.decisions[0].answer.chose).toBe("3,000 דולר בשנה");
  });
});

describe("each side stays on its own connector", () => {
  it("refuses staff on the portal connector and the client on the staff one", async () => {
    const { nux, ariel, oren } = await setup();
    const staffOnPortal = await as(ariel, portal, "get_status");
    expect(staffOnPortal.text).toContain("client portal");

    const clientOnStaff = await as(oren, staff, "list_tasks", { client: nux.name });
    expect(clientOnStaff.text).toContain("/api/mcp/portal");
  });

  it("never shows one client's portal user another client's tasks", async () => {
    const { other, ariel, oren } = await setup();
    await as(ariel, staff, "create_task", { client: other.name, title: "סודי של לקוח אחר", clientVisible: true });
    const list = await as(oren, portal, "list_tasks", { search: "סודי" });
    expect(list.count).toBe(0);
  });
});

describe("progress counts every visible task, past any list cap", () => {
  it("counts 65 visible promises as 65, ignoring hidden, archived and steps", async () => {
    const { nux, oren } = await setup();
    await prisma.task.createMany({
      data: Array.from({ length: 65 }, (_, i) => ({
        clientId: nux.id,
        title: `תהליך ${i}`,
        clientVisible: true,
        status: i < 13 ? ("DONE" as const) : ("OPEN" as const),
      })),
    });
    const parent = await prisma.task.findFirstOrThrow({ where: { clientId: nux.id, title: "תהליך 20" } });
    await prisma.task.createMany({
      data: [
        { clientId: nux.id, title: "פנימי", clientVisible: false },
        { clientId: nux.id, title: "בוטל", clientVisible: true, status: "ARCHIVED" },
        { clientId: nux.id, title: "שלב", clientVisible: true, parentId: parent.id },
      ],
    });

    const status = await as(oren, portal, "get_status");
    expect(status.progress.total).toBe(65);
    expect(status.progress.done).toBe(13);
    expect(status.progress.percentDone).toBe(20);
  });
});
