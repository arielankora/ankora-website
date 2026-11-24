import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestUser } from "./factories";
import { findAgentByRef, setAgentSlug } from "@/lib/app-domain/agents";

// Agents (24.11.2026): Claude finds an agent by the name a person uses, not
// only by its id, and a manager can give an agent a readable id.

async function setup() {
  const { user: ariel } = await createTestUser({ role: "SUPER_ADMIN" });
  const { user: hadas } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const weekly = await prisma.agent.create({ data: { slug: "agent-mwsif5wq", name: "דוח שבועי ללקוח", purpose: "דוח", kind: "SCHEDULED" } });
  const usage = await prisma.agent.create({ data: { slug: "agent-mwsiw29k", name: "שימוש בקלוד: דוח שבועי", purpose: "דוח", kind: "SCHEDULED" } });
  const hebrew = await prisma.agent.create({ data: { slug: "hebrew", name: "כתיבה בעברית", purpose: "סקיל", kind: "SKILL" } });
  return { ariel, hadas, weekly, usage, hebrew };
}

describe("finding an agent by what a person calls it", () => {
  it("finds it by its id or by its exact name, quotes and case aside", async () => {
    const { weekly } = await setup();
    expect((await findAgentByRef("agent-mwsif5wq")).agent?.id).toBe(weekly.id);
    expect((await findAgentByRef(" דוח שבועי ללקוח ")).agent?.id).toBe(weekly.id);
    expect((await findAgentByRef("\"דוח שבועי ללקוח\"")).agent?.id).toBe(weekly.id);
  });

  it("offers the closest agents when nothing matches exactly, best first, and never an archived one", async () => {
    const { weekly, usage } = await setup();
    await prisma.agent.create({ data: { slug: "old-weekly", name: "דוח שבועי ישן", purpose: "x", kind: "SCHEDULED", archivedAt: new Date() } });
    const r = await findAgentByRef("דוח שבועי");
    expect(r.agent).toBeNull();
    expect(r.candidates.map((c) => c.slug)).toEqual([weekly.slug, usage.slug]);
    expect((await findAgentByRef("משהו אחר לגמרי")).candidates).toEqual([]);
  });
});

describe("a readable id", () => {
  it("a manager changes it; it is checked, unique, and the old id no longer finds the agent", async () => {
    const { ariel, hadas, weekly } = await setup();
    await expect(setAgentSlug(hadas, weekly.id, "weekly-client-report")).rejects.toThrow();
    await expect(setAgentSlug(ariel, weekly.id, "דוח")).rejects.toMatchObject({ code: "agents.slugFormat" });
    await expect(setAgentSlug(ariel, weekly.id, "library")).rejects.toMatchObject({ code: "agents.slugFormat" });
    await expect(setAgentSlug(ariel, weekly.id, "hebrew")).rejects.toMatchObject({ code: "agents.slugTaken" });
    await setAgentSlug(ariel, weekly.id, " Weekly-Client-Report ");
    expect((await prisma.agent.findUniqueOrThrow({ where: { id: weekly.id } })).slug).toBe("weekly-client-report");
    expect((await findAgentByRef("weekly-client-report")).agent?.id).toBe(weekly.id);
    expect((await findAgentByRef("agent-mwsif5wq")).agent).toBeNull();
    expect(await prisma.auditEvent.count({ where: { action: "agent.slug", entityId: weekly.id } })).toBe(1);
  });

  it("keeps the id of a skill another agent requires", async () => {
    const { ariel, weekly, hebrew } = await setup();
    await prisma.agentVersion.create({ data: { agentId: weekly.id, version: 1, state: "APPROVED", requirements: { skills: [{ slug: "hebrew", minVersion: 1 }] } } });
    await expect(setAgentSlug(ariel, hebrew.id, "hebrew-writing")).rejects.toMatchObject({ code: "agents.slugRequired" });
    await prisma.agentVersion.updateMany({ where: { agentId: weekly.id }, data: { state: "REJECTED" } });
    await setAgentSlug(ariel, hebrew.id, "hebrew-writing");
  });
});
