import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { addClientContact, addClientOrganization, updateClientContact } from "@/lib/app-domain/client-contacts";
import {
  addClientDomain,
  addClientSource,
  clientsForEmail,
  listClientSources,
  removeClientDomain,
  removeClientSource,
  updateClientSource,
} from "@/lib/app-domain/client-sources";

// Org brain, phase 2 (claude/org-brain-spec-2026-10-12.md, 3.2 and 3.5).
//
// What is worth holding here: codes are per client and never reused, an
// item cannot cite what is not in the register, Ankora's own writing never
// confirms anything, and a domain never leaks one client to another.

async function employeeOn(...clientIds: string[]) {
  const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  for (const clientId of clientIds) await prisma.userClientAccess.create({ data: { userId: user.id, clientId } });
  return user;
}

describe("source register", () => {
  it("numbers sources per client, and never reuses a removed code", async () => {
    const a = await createTestClient({ name: "A" });
    const b = await createTestClient({ name: "B" });
    const user = await employeeOn(a.id, b.id);

    const s1 = await addClientSource(user, { clientId: a.id, kind: "TRANSCRIPT", title: "Nextage & Ankora" });
    const s2 = await addClientSource(user, { clientId: a.id, kind: "ANKORA_DOCUMENT", title: "KI" });
    const other = await addClientSource(user, { clientId: b.id, kind: "PERSON", title: "שיחה עם המנכ״ל" });
    expect([s1.code, s2.code, other.code]).toEqual(["S1", "S2", "S1"]);
    // An Ankora document is secondary unless somebody says otherwise.
    expect(s2.weight).toBe("SECONDARY");

    await removeClientSource(user, s2.id);
    const s3 = await addClientSource(user, { clientId: a.id, kind: "CLIENT_DOCUMENT", title: "הסכם" });
    expect(s3.code).toBe("S3");
    expect((await listClientSources(user, a.id)).map((s) => s.code)).toEqual(["S1", "S3"]);
  });

  it("refuses a document or task of another client as a source", async () => {
    const a = await createTestClient({ name: "A" });
    const b = await createTestClient({ name: "B" });
    const user = await employeeOn(a.id, b.id);
    const task = await prisma.task.create({ data: { clientId: b.id, title: "משימה של B" } });
    await expect(
      addClientSource(user, { clientId: a.id, kind: "TASK", title: "משימה", externalIds: [task.id] })
    ).rejects.toThrow("לא נמצאה");
    const ok = await addClientSource(user, { clientId: b.id, kind: "TASK", title: "משימה", externalIds: [task.id] });
    expect(ok.externalRefs).toEqual([{ system: "TASK", id: task.id }]);
  });

  it("an employee of another client cannot read or write the register", async () => {
    const a = await createTestClient({ name: "A" });
    const b = await createTestClient({ name: "B" });
    const onB = await employeeOn(b.id);
    await expect(listClientSources(onB, a.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(addClientSource(onB, { clientId: a.id, kind: "PERSON", title: "x" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("items cite the register", () => {
  it("needs a source unless missing, and refuses a code the register does not have", async () => {
    const client = await createTestClient();
    const user = await employeeOn(client.id);
    await addClientSource(user, { clientId: client.id, kind: "TRANSCRIPT", title: "פגישה" });

    await expect(addClientContact(user, { clientId: client.id, name: "אורן" })).rejects.toThrow("צריך מקור");
    await expect(addClientContact(user, { clientId: client.id, name: "אורן", sources: [{ code: "S9" }] })).rejects.toThrow("S9");
    // Inside free text too (R17).
    await expect(
      addClientContact(user, { clientId: client.id, name: "אורן", sources: [{ code: "S1" }], context: "כך אמר [S4 02:10]" })
    ).rejects.toThrow("S4");
    // A missing item is something nobody has told us yet.
    const missing = await addClientContact(user, {
      clientId: client.id,
      role: "מנקה",
      knowledgeStatus: "MISSING",
      toResolve: "לבקש את השם",
    });
    expect(missing.sources).toEqual([]);

    // Nothing was left behind by the refused attempts.
    expect(await prisma.person.count()).toBe(1);
  });

  it("an item whose sources are all Ankora's own is stored as uncertain (R14)", async () => {
    const client = await createTestClient();
    const user = await employeeOn(client.id);
    await addClientSource(user, { clientId: client.id, kind: "ANKORA_DOCUMENT", title: "KI" }); // S1, secondary
    await addClientSource(user, { clientId: client.id, kind: "TRANSCRIPT", title: "פגישה" }); // S2, primary

    const org = await addClientOrganization(user, { clientId: client.id, name: "Nextage", sources: [{ code: "S1" }] });
    expect(org.knowledgeStatus).toBe("UNCERTAIN");
    expect(org.toResolve).toContain("אישור");

    const contact = await addClientContact(user, {
      clientId: client.id,
      name: "שני",
      sources: [{ code: "S1" }, { code: "S2", at: "08:13" }],
    });
    expect(contact.knowledgeStatus).toBe("CONFIRMED");
    expect(contact.sources).toEqual([{ code: "S1" }, { code: "S2", at: "08:13" }]);

    // Dropping the primary source on edit lowers it too.
    const edited = await updateClientContact(user, contact.id, { sources: [{ code: "S1" }] });
    expect(edited.knowledgeStatus).toBe("UNCERTAIN");
  });

  it("a cited source cannot be removed, and its weight cannot change under the items", async () => {
    const client = await createTestClient();
    const user = await employeeOn(client.id);
    const s1 = await addClientSource(user, { clientId: client.id, kind: "TRANSCRIPT", title: "פגישה" });
    const s2 = await addClientSource(user, { clientId: client.id, kind: "TRANSCRIPT", title: "פגישה שנייה" });
    await addClientContact(user, { clientId: client.id, name: "אורן", sources: [{ code: "S1" }] });
    await addClientContact(user, { clientId: client.id, name: "גיא", sources: [{ code: "S1" }], context: "ראו [S2]" });

    await expect(removeClientSource(user, s1.id)).rejects.toThrow("2 פריטים");
    await expect(removeClientSource(user, s2.id)).rejects.toThrow("1 פריטים");
    await expect(updateClientSource(user, s1.id, { weight: "SECONDARY" })).rejects.toThrow("המשקל");
    const renamed = await updateClientSource(user, s1.id, { title: "פגישת היכרות" });
    expect(renamed.title).toBe("פגישת היכרות");
  });
});

describe("client domains", () => {
  it("a client domain is one client's; a partner domain may be several clients'", async () => {
    const a = await createTestClient({ name: "A" });
    const b = await createTestClient({ name: "B" });
    const user = await employeeOn(a.id, b.id);

    await addClientDomain(user, { clientId: a.id, domain: "https://www.NUX.ai/", kind: "CLIENT" });
    await expect(addClientDomain(user, { clientId: b.id, domain: "nux.ai", kind: "CLIENT" })).rejects.toThrow("לקוח אחר");
    await expect(addClientDomain(user, { clientId: a.id, domain: "gmail.com", kind: "CLIENT" })).rejects.toThrow("ציבורי");

    await addClientDomain(user, { clientId: a.id, domain: "nextage.co.il", kind: "PARTNER", organizationName: "Nextage" });
    await addClientDomain(user, { clientId: b.id, domain: "nextage.co.il", kind: "PARTNER", organizationName: "Nextage" });
    expect(await prisma.organization.count()).toBe(1);
    expect((await prisma.organization.findFirstOrThrow()).domains).toEqual(["nextage.co.il"]);

    expect(await clientsForEmail(user, "Oren@nux.ai")).toEqual([{ clientId: a.id, kind: "CLIENT" }]);
    expect((await clientsForEmail(user, "shani@nextage.co.il")).map((r) => r.kind)).toEqual(["PARTNER", "PARTNER"]);
    expect(await clientsForEmail(user, "someone@gmail.com")).toEqual([]);
  });

  it("never names a client the person cannot reach", async () => {
    const a = await createTestClient({ name: "A" });
    const b = await createTestClient({ name: "B" });
    const both = await employeeOn(a.id, b.id);
    const onlyA = await employeeOn(a.id);
    await addClientDomain(both, { clientId: b.id, domain: "secret-client.com", kind: "CLIENT" });
    expect(await clientsForEmail(onlyA, "ceo@secret-client.com")).toEqual([]);

    const row = await addClientDomain(both, { clientId: a.id, domain: "a.com", kind: "CLIENT" });
    await removeClientDomain(both, row.id);
    // Removed, so another client may now claim it.
    await addClientDomain(both, { clientId: b.id, domain: "a.com", kind: "CLIENT" });
  });
});
