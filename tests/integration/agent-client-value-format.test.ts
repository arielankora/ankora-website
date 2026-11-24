import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { clientEmailContacts, setClientValue } from "@/lib/app-domain/agents";

// Agents (24.11.2026): a client value is checked against its parameter's
// type (EMAIL, NUMBER), and recipients can be chosen from the client's
// file, only among contacts the person may see and that may go to Claude.

const PARAMS = [
  { key: "to", label: "נמען הדוח", level: "CLIENT", type: "EMAIL", required: true },
  { key: "quota", label: "מכסה", level: "CLIENT", type: "NUMBER" },
  { key: "notes", label: "הערות", level: "CLIENT", type: "LONG_TEXT" },
];

async function setup() {
  const { user: ariel } = await createTestUser({ role: "SUPER_ADMIN" });
  const { user: hadas } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const grantor = await createTestClient({ name: "Grantor" });
  await prisma.userClientAccess.create({ data: { userId: hadas.id, clientId: grantor.id } });
  const agent = await prisma.agent.create({ data: { slug: "weekly", name: "Weekly", purpose: "בדיקה", kind: "SCHEDULED", versions: { create: { version: 1, state: "APPROVED", params: PARAMS } } } });
  return { ariel, hadas, grantor, agent };
}

const valueOf = (agentId: string, clientId: string, key: string) => prisma.agentClientValue.findFirst({ where: { agentId, clientId, key } }).then((v) => v?.value ?? null);

describe("a client value's format", () => {
  it("takes one email or several, and saves them tidied", async () => {
    const { hadas, grantor, agent } = await setup();
    await setClientValue(hadas, { agentId: agent.id, clientId: grantor.id, key: "to", value: " nadav@grantor.ai ;finance@grantor.ai,\n" });
    expect(await valueOf(agent.id, grantor.id, "to")).toBe("nadav@grantor.ai, finance@grantor.ai");
  });

  it("refuses what is not an email or a number, and keeps the old value", async () => {
    const { hadas, grantor, agent } = await setup();
    await setClientValue(hadas, { agentId: agent.id, clientId: grantor.id, key: "to", value: "nadav@grantor.ai" });
    await expect(setClientValue(hadas, { agentId: agent.id, clientId: grantor.id, key: "to", value: "nadav@grantor.ai, נדב" })).rejects.toMatchObject({ code: "agents.valueEmail", values: { value: "נדב" } });
    expect(await valueOf(agent.id, grantor.id, "to")).toBe("nadav@grantor.ai");
    await expect(setClientValue(hadas, { agentId: agent.id, clientId: grantor.id, key: "quota", value: "חמש" })).rejects.toMatchObject({ code: "agents.valueNumber" });
    await setClientValue(hadas, { agentId: agent.id, clientId: grantor.id, key: "quota", value: "15" });
    // Free text stays free.
    await setClientValue(hadas, { agentId: agent.id, clientId: grantor.id, key: "notes", value: "בלי @ ובלי מספרים" });
    expect(await valueOf(agent.id, grantor.id, "notes")).toBe("בלי @ ובלי מספרים");
  });
});

describe("recipients from the client's file", () => {
  it("lists current contacts with an email that this person may see and that may go to Claude", async () => {
    const { ariel, hadas, grantor } = await setup();
    const contact = async (name: string, emails: string[], extra: Record<string, unknown> = {}) => {
      const person = await prisma.person.create({ data: { name, emails } });
      await prisma.clientContact.create({ data: { clientId: grantor.id, personId: person.id, ...extra } });
    };
    await contact("נדב דדון", ["nadav@grantor.ai"], { isPrimary: true });
    await contact("כספים", ["finance@grantor.ai", "FINANCE@grantor.ai"]);
    await contact("בלי מייל", []);
    await contact("עזב", ["old@grantor.ai"], { endedAt: new Date() });
    await contact("רגיש", ["secret@grantor.ai"], { sensitivity: "SENSITIVE" });
    await contact("לאריאל בלבד", ["restricted@grantor.ai"], { audience: "RESTRICTED", audienceUserIds: [ariel.id] });

    const forHadas = (await clientEmailContacts(hadas, [grantor.id])).get(grantor.id);
    expect(forHadas).toEqual([
      { name: "נדב דדון", email: "nadav@grantor.ai" },
      { name: "כספים", email: "finance@grantor.ai" },
    ]);
    const forAriel = (await clientEmailContacts(ariel, [grantor.id])).get(grantor.id)!.map((c) => c.email);
    expect(forAriel).toContain("restricted@grantor.ai");
    expect(forAriel).not.toContain("secret@grantor.ai");
  });

  it("gives nothing for a client the person cannot access or that is kept from AI", async () => {
    const { hadas, ariel } = await setup();
    const other = await createTestClient({ name: "Other" });
    const person = await prisma.person.create({ data: { name: "x", emails: ["x@other.com"] } });
    await prisma.clientContact.create({ data: { clientId: other.id, personId: person.id } });
    expect((await clientEmailContacts(hadas, [other.id])).size).toBe(0);
    await prisma.client.update({ where: { id: other.id }, data: { aiExcluded: true } });
    expect((await clientEmailContacts(ariel, [other.id])).size).toBe(0);
  });
});
