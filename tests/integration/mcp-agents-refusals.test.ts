import { describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { createInstallation, resolveClients, setClientValue } from "@/lib/app-domain/agents";
import type { AgentBlock } from "@/lib/agents/model";

// What the agent tools refuse, and how the refusal reaches Claude (test
// gaps, 23.11.2026): in the domain's words, never "unexpected error", and
// with nothing written.

vi.mock("@/lib/mcp/auth", () => ({
  actorFromAuthInfo: (authInfo: { extra: { user: User } }) => authInfo.extra.user,
}));

import { registerAnkoraTools } from "@/lib/mcp/tools";

type Handler = (args: unknown, ctx: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>;
const tools = new Map<string, Handler>();
registerAnkoraTools({ registerTool: (name: string, _c: unknown, h: Handler) => tools.set(name, h) } as never);

async function call(user: User, name: string, args: unknown) {
  const result = await tools.get(name)!(args, { http: { authInfo: { extra: { user } } } });
  const text = result.content.map((c) => c.text).join("");
  expect(text).not.toContain("unexpected server error");
  return { text, isError: result.isError };
}

const BLOCKS: AgentBlock[] = [{ key: "role", kind: "role", title: "תפקיד", body: "סמן ב-{{label}} וחתום {{sig}}." }];
const PARAMS = [
  { key: "label", label: "תווית", level: "INSTALLATION", required: true },
  { key: "sig", label: "חתימה", level: "CLIENT", required: false, default: "צוות אנקורה" },
];

async function setup() {
  const { user: hadas } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: noa } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: ariel } = await createTestUser({ role: "SUPER_ADMIN" });
  const nux = await createTestClient({ name: "NUX" });
  for (const u of [hadas, noa]) await prisma.userClientAccess.create({ data: { userId: u.id, clientId: nux.id } });
  const agent = await prisma.agent.create({
    data: { slug: "refusals", name: "Refusals", purpose: "בדיקה", kind: "SCHEDULED", versions: { create: { version: 1, state: "APPROVED", blocks: BLOCKS, params: PARAMS, files: [{ path: "scripts/run.py", content: "print(1)" }] } } },
  });
  const inst = await createInstallation(hadas, { agentId: agent.id, surface: "SCHEDULED", clientScope: "ONE", clientIds: [nux.id], checkEvery: "RUN" });
  return { hadas, noa, ariel, nux, agent, inst };
}

describe("decide_approval on an agent version", () => {
  it("does not let a team member approve or reject one, and leaves it waiting", async () => {
    const { hadas, ariel, agent } = await setup();
    const pending = await prisma.agentVersion.create({ data: { agentId: agent.id, version: 2, state: "PENDING", blocks: BLOCKS, params: PARAMS, changeNote: "שינוי", submittedAt: new Date(), createdById: hadas.id } });

    for (const decision of ["approve", "reject"] as const) {
      const r = await call(hadas, "decide_approval", { kind: "agent", id: pending.id, decision, reason: "לא" });
      expect(r.text).toContain("Nothing was changed.");
    }
    expect((await prisma.agentVersion.findUniqueOrThrow({ where: { id: pending.id } })).state).toBe("PENDING");

    const done = await call(ariel, "decide_approval", { kind: "agent", id: pending.id, decision: "approve" });
    expect(done.isError).toBeFalsy();
    expect((await prisma.agentVersion.findUniqueOrThrow({ where: { id: pending.id } })).state).toBe("APPROVED");
  });
});

describe("record_agent_run", () => {
  it("refuses someone else's installation, and records nothing", async () => {
    const { noa, ariel, inst } = await setup();
    for (const who of [noa, ariel]) {
      const r = await call(who, "record_agent_run", { installation: inst.id, outcome: "FAILED", summary: "נכשל" });
      expect(r.isError).toBe(true);
      expect(r.text).toContain("שייכת למישהו אחר");
    }
    expect(await prisma.agentRun.count({ where: { installationId: inst.id } })).toBe(0);
    expect(await prisma.notification.count({ where: { type: "agent.run_failed" } })).toBe(0);
  });

  it("refuses a removed or unknown installation, and a blank summary", async () => {
    const { hadas, inst } = await setup();
    const unknown = await call(hadas, "record_agent_run", { installation: "no-such-installation", outcome: "OK", summary: "עבר" });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toContain("ההתקנה לא נמצאה");
    const blank = await call(hadas, "record_agent_run", { installation: inst.id, outcome: "OK", summary: "   " });
    expect(blank.isError).toBe(true);
    expect(blank.text).toContain("agents.runSummaryRequired");
    await prisma.agentInstallation.update({ where: { id: inst.id }, data: { status: "REMOVED" } });
    const removed = await call(hadas, "record_agent_run", { installation: inst.id, outcome: "OK", summary: "עבר" });
    expect(removed.text).toContain("ההתקנה לא נמצאה");
    expect(await prisma.agentRun.count()).toBe(0);
  });
});

describe("set_agent_installation_value", () => {
  it("refuses a key the version does not have, or one that is not at installation level", async () => {
    const { hadas, inst } = await setup();
    for (const key of ["nope", "sig"]) {
      const r = await call(hadas, "set_agent_installation_value", { installation: inst.id, key, value: "x" });
      expect(r.isError).toBe(true);
      expect(r.text).toContain(`"${key}" הוא לא פרמטר ברמת התקנה בסוכן הזה.`);
    }
    expect((await prisma.agentInstallation.findUniqueOrThrow({ where: { id: inst.id } })).values).toEqual({});
  });

  it("refuses someone else's installation and a secret, sets a value and clears it with an empty one", async () => {
    const { hadas, noa, inst } = await setup();
    expect((await call(noa, "set_agent_installation_value", { installation: inst.id, key: "label", value: "x" })).text).toContain("שייכת למישהו אחר");
    expect((await call(hadas, "set_agent_installation_value", { installation: inst.id, key: "label", value: "ghp_1234567890abcdefghijklmnopqrstuvwxyzAB" })).text).toContain("סודות לא נכתבים");

    expect((await call(hadas, "set_agent_installation_value", { installation: inst.id, key: "label", value: " Ankora/Done " })).isError).toBeFalsy();
    expect((await prisma.agentInstallation.findUniqueOrThrow({ where: { id: inst.id } })).values).toEqual({ label: "Ankora/Done" });
    expect((await call(hadas, "get_agent", { installation: inst.id })).text).toContain("סמן ב-Ankora/Done");
    await call(hadas, "set_agent_installation_value", { installation: inst.id, key: "label", value: "" });
    expect((await prisma.agentInstallation.findUniqueOrThrow({ where: { id: inst.id } })).values).toEqual({});
  });
});

describe("get_agent_file", () => {
  it("returns only a file of the version, never a path outside it", async () => {
    const { hadas, inst } = await setup();
    for (const path of ["../scripts/run.py", "/scripts/run.py", "scripts/../../etc/passwd", "scripts", "Scripts/run.py"]) {
      const r = await call(hadas, "get_agent_file", { installation: inst.id, path });
      expect(r.isError).toBe(true);
      expect(r.text).toContain("אין קובץ כזה בגרסה של ההתקנה. הקבצים: scripts/run.py.");
    }
    // Spaces around the path are not part of it.
    expect((await call(hadas, "get_agent_file", { installation: inst.id, path: " scripts/run.py " })).text).toBe("print(1)");
  });
});

describe("client values from the client's file", () => {
  it("fills every client of an ALL_MINE installation from its own file, and skips a \"no AI\" client", async () => {
    const { hadas, nux } = await setup();
    const rimed = await createTestClient({ name: "Rimed" });
    const hidden = await createTestClient({ name: "Hidden" });
    await prisma.client.update({ where: { id: hidden.id }, data: { aiExcluded: true } });
    for (const c of [rimed, hidden]) await prisma.userClientAccess.create({ data: { userId: hadas.id, clientId: c.id } });
    await prisma.clientDomain.createMany({ data: [{ clientId: nux.id, domain: "nux.co.il", kind: "CLIENT" }, { clientId: nux.id, domain: "nux.com", kind: "CLIENT" }, { clientId: hidden.id, domain: "hidden.com", kind: "CLIENT" }] });
    const params = [
      { key: "who", label: "שם", level: "CLIENT" as const, type: "TEXT" as const, required: true, default: null, clientField: "name" as const },
      { key: "domains", label: "דומיינים", level: "CLIENT" as const, type: "LIST" as const, required: true, default: null, clientField: "domains" as const },
      { key: "sig", label: "חתימה", level: "CLIENT" as const, type: "TEXT" as const, required: false, default: null, clientField: null },
    ];
    const agent = await prisma.agent.create({ data: { slug: "fields", name: "Fields", purpose: "בדיקה", kind: "SCHEDULED", versions: { create: { version: 1, state: "APPROVED", blocks: [{ key: "r", kind: "rules", title: "מיילים", body: "רק מ-{{domains}}." }], params } } } });
    await setClientValue(hadas, { agentId: agent.id, clientId: rimed.id, key: "sig", value: "הדס, Rimed" });

    const clients = await resolveClients(hadas, agent.id, params, { clientScope: "ALL_MINE", clientIds: [] });
    expect(clients.map((c) => c.name).sort()).toEqual(["NUX", "Rimed"]);
    expect(clients.find((c) => c.name === "NUX")?.values).toEqual({ who: "NUX", domains: expect.stringMatching(/^nux\.(co\.il|com), nux\.(co\.il|com)$/) });
    expect(clients.find((c) => c.name === "Rimed")?.values).toEqual({ who: "Rimed", domains: "", sig: "הדס, Rimed" });

    const inst = await createInstallation(hadas, { agentId: agent.id, surface: "SCHEDULED", clientScope: "ALL_MINE", clientIds: [], checkEvery: "RUN" });
    const text = (await call(hadas, "get_agent", { installation: inst.id })).text;
    expect(text).toContain("| Rimed | Rimed | חסר | הדס, Rimed |");
    expect(text).toContain('אל תעבוד על Rimed: חסר ערך ל"דומיינים"');
    expect(text).not.toContain("Hidden");
    expect(text).not.toContain("hidden.com");
  });
});
