import { describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "./setup";
import { createTestUser } from "./factories";

// Agents (24.11.2026): categories on the agents screen. A manager edits the
// list and puts an agent in several; a team member sees them and changes
// nothing. Through the screen's actions, so the form fields are held too.

const session = vi.hoisted(() => ({ user: null as User | null }));

vi.mock("@/lib/app-auth/session", () => {
  class UnauthorizedError extends Error {}
  const current = async () => {
    if (!session.user) throw new UnauthorizedError();
    return session.user;
  };
  return { UnauthorizedError, requireUser: current, requireUserOrThrow: current, getCurrentUser: async () => session.user };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import {
  createAgentCategoryAction,
  moveAgentCategoryAction,
  renameAgentCategoryAction,
  setAgentCategoriesAction,
  setAgentCategoryArchivedAction,
} from "@/app/(product)/app/(authenticated)/agents/actions";
import { listAgentCategories } from "@/lib/app-domain/agent-categories";
import { listAgents } from "@/lib/app-domain/agents";

function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const one of [v].flat()) fd.append(k, one);
  return fd;
}

const as = (user: User) => {
  session.user = user;
};

async function setup() {
  const { user: hadas } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: ariel } = await createTestUser({ role: "SUPER_ADMIN" });
  const agent = await prisma.agent.create({ data: { slug: "mail", name: "Mail", purpose: "בדיקה", kind: "SCHEDULED" } });
  return { hadas, ariel, agent };
}

async function create(name: string) {
  expect(await createAgentCategoryAction(undefined, form({ name }))).toEqual({ ok: true });
  return prisma.agentCategory.findFirstOrThrow({ where: { name: name.trim().replace(/\s+/g, " "), archivedAt: null } });
}

const names = async (user: User, withArchived = false) => (await listAgentCategories(user, { withArchived })).map((c) => c.name);

describe("the category list", () => {
  it("a manager adds, renames and reorders; names are cleaned and unique", async () => {
    const { ariel } = await setup();
    as(ariel);
    const clients = await create("לקוחות");
    const internal = await create("  תפעול   פנימי ");
    expect(await names(ariel)).toEqual(["לקוחות", "תפעול פנימי"]);

    expect(await createAgentCategoryAction(undefined, form({ name: "לקוחות" }))).toEqual({ error: "כבר יש קטגוריה בשם הזה." });
    expect(await createAgentCategoryAction(undefined, form({ name: " " }))).toEqual({ error: "צריך שם לקטגוריה, עד 40 תווים." });
    expect(await createAgentCategoryAction(undefined, form({ name: "א".repeat(41) }))).toEqual({ error: "צריך שם לקטגוריה, עד 40 תווים." });
    expect(await renameAgentCategoryAction(undefined, form({ id: internal.id, name: "לקוחות" }))).toEqual({ error: "כבר יש קטגוריה בשם הזה." });

    expect(await renameAgentCategoryAction(undefined, form({ id: internal.id, name: "תפעול" }))).toEqual({ ok: true });
    expect(await moveAgentCategoryAction(internal.id, "up")).toEqual({ ok: true });
    expect(await names(ariel)).toEqual(["תפעול", "לקוחות"]);
    // At the edge a move changes nothing.
    expect(await moveAgentCategoryAction(internal.id, "up")).toEqual({ ok: true });
    expect(await moveAgentCategoryAction(clients.id, "down")).toEqual({ ok: true });
    expect(await names(ariel)).toEqual(["תפעול", "לקוחות"]);

    const audit = await prisma.auditEvent.findMany({ where: { entityType: "AgentCategory" }, select: { action: true } });
    expect(audit.map((a) => a.action).sort()).toEqual(["agent_category.create", "agent_category.create", "agent_category.rename"]);
  });

  it("a team member sees the list and changes nothing", async () => {
    const { hadas, ariel, agent } = await setup();
    as(ariel);
    const clients = await create("לקוחות");
    as(hadas);
    expect(await names(hadas)).toEqual(["לקוחות"]);
    expect((await createAgentCategoryAction(undefined, form({ name: "שלי" }))).error).toBeTruthy();
    expect((await renameAgentCategoryAction(undefined, form({ id: clients.id, name: "אחר" }))).error).toBeTruthy();
    expect((await setAgentCategoryArchivedAction(clients.id, true)).error).toBeTruthy();
    expect((await setAgentCategoriesAction(undefined, form({ agentId: agent.id, categoryId: clients.id }))).error).toBeTruthy();
    expect(await names(hadas, true)).toEqual(["לקוחות"]);
    expect((await prisma.agent.findUniqueOrThrow({ where: { id: agent.id } })).categoryIds).toEqual([]);
  });
});

describe("an agent's categories", () => {
  it("an agent can be in several, set as a whole list, and the agents screen shows them in the list's order", async () => {
    const { ariel, agent } = await setup();
    as(ariel);
    const clients = await create("לקוחות");
    const internal = await create("תפעול פנימי");
    const personal = await create("אישי");
    expect(await setAgentCategoriesAction(undefined, form({ agentId: agent.id, categoryId: [personal.id, clients.id] }))).toEqual({ ok: true });
    let row = (await listAgents(ariel)).find((a) => a.id === agent.id)!;
    expect(row.categories.map((c) => c.name)).toEqual(["לקוחות", "אישי"]);

    expect(await setAgentCategoriesAction(undefined, form({ agentId: agent.id, categoryId: internal.id }))).toEqual({ ok: true });
    row = (await listAgents(ariel)).find((a) => a.id === agent.id)!;
    expect(row.categories.map((c) => c.name)).toEqual(["תפעול פנימי"]);

    // None chosen clears them.
    expect(await setAgentCategoriesAction(undefined, form({ agentId: agent.id }))).toEqual({ ok: true });
    expect((await listAgents(ariel)).find((a) => a.id === agent.id)!.categories).toEqual([]);
  });

  it("refuses a category that is archived or unknown, and changes nothing", async () => {
    const { ariel, agent } = await setup();
    as(ariel);
    const clients = await create("לקוחות");
    const old = await create("ישן");
    await setAgentCategoryArchivedAction(old.id, true);
    expect(await setAgentCategoriesAction(undefined, form({ agentId: agent.id, categoryId: [clients.id, old.id] }))).toEqual({ error: "הקטגוריה לא נמצאה." });
    expect(await setAgentCategoriesAction(undefined, form({ agentId: agent.id, categoryId: "nope" }))).toEqual({ error: "הקטגוריה לא נמצאה." });
    expect((await prisma.agent.findUniqueOrThrow({ where: { id: agent.id } })).categoryIds).toEqual([]);
  });

  it("archiving takes a category off the screen without losing its agents, and a restore brings them back", async () => {
    const { ariel, agent } = await setup();
    as(ariel);
    const clients = await create("לקוחות");
    const internal = await create("תפעול פנימי");
    await setAgentCategoriesAction(undefined, form({ agentId: agent.id, categoryId: [clients.id, internal.id] }));

    expect(await setAgentCategoryArchivedAction(clients.id, true)).toEqual({ ok: true });
    expect(await names(ariel)).toEqual(["תפעול פנימי"]);
    expect(await listAgentCategories(ariel, { withArchived: true })).toEqual([
      { id: internal.id, name: "תפעול פנימי", archived: false, agents: 1 },
      { id: clients.id, name: "לקוחות", archived: true, agents: 1 },
    ]);
    expect((await listAgents(ariel)).find((a) => a.id === agent.id)!.categories.map((c) => c.name)).toEqual(["תפעול פנימי"]);

    // Saving the agent's form meanwhile keeps the archived one it is in.
    await setAgentCategoriesAction(undefined, form({ agentId: agent.id, categoryId: internal.id }));

    // Its name was taken while it was archived: the restore is refused.
    const taken = await create("לקוחות");
    expect(await setAgentCategoryArchivedAction(clients.id, false)).toEqual({ error: "כבר יש קטגוריה בשם הזה." });
    await setAgentCategoryArchivedAction(taken.id, true);

    expect(await setAgentCategoryArchivedAction(clients.id, false)).toEqual({ ok: true });
    expect(await names(ariel)).toEqual(["תפעול פנימי", "לקוחות"]);
    expect((await listAgents(ariel)).find((a) => a.id === agent.id)!.categories.map((c) => c.name)).toEqual(["תפעול פנימי", "לקוחות"]);
  });
});

describe("the client filter's data", () => {
  it("lists the clients an agent's installations run on, and whether one runs on all", async () => {
    const { ariel, agent } = await setup();
    const version = await prisma.agentVersion.create({ data: { agentId: agent.id, version: 1, state: "APPROVED" } });
    const client = await prisma.client.create({ data: { name: "NUX" } });
    const base = { agentId: agent.id, userId: ariel.id, surface: "SCHEDULED" as const, pinnedVersionId: version.id };
    await prisma.agentInstallation.create({ data: { ...base, clientScope: "ONE", clientIds: [client.id] } });
    let row = (await listAgents(ariel)).find((a) => a.id === agent.id)!;
    expect(row.clientIds).toEqual([client.id]);
    expect(row.allClients).toBe(false);

    await prisma.agentInstallation.create({ data: { ...base, clientScope: "ALL_MINE", clientIds: [] } });
    row = (await listAgents(ariel)).find((a) => a.id === agent.id)!;
    expect(row.allClients).toBe(true);
  });
});
