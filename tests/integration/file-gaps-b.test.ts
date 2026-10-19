import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { addClientContact, updateClientContact } from "@/lib/app-domain/client-contacts";
import { addSystemAccess } from "@/lib/app-domain/system-map";
import { addProcess, approveProcessVersion, saveProcessVersion, updateProcess } from "@/lib/app-domain/processes";
import { addClientPolicy, approveClientPolicy, policyHistory, updateClientPolicy } from "@/lib/app-domain/client-policies";
import { fieldStatusFrom } from "@/lib/knowledge";

// Spec 3.1, 3.5, 3.9, 3.11: when an item was last confirmed, fields still
// missing on a contact, what the rules said when a procedure was approved,
// a rule's earlier versions, and the links a process and a contact keep.

const S1 = [{ code: "S1" }];
const S2 = [{ code: "S2" }];

async function setup() {
  const client = await createTestClient({ name: "NUX" });
  const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
  await prisma.userClientAccess.create({ data: { userId: user.id, clientId: client.id } });
  await addClientSource(user, { clientId: client.id, kind: "PERSON", title: "הדס" });
  await addClientSource(user, { clientId: client.id, kind: "PERSON", title: "גיא" });
  return { client, user, admin };
}

describe("file gaps", () => {
  it("records when an item was confirmed, and not on a typo", async () => {
    const { client, user } = await setup();
    const c = await addClientContact(user, { clientId: client.id, name: "איילה", knowledgeStatus: "UNCERTAIN", toResolve: "לברר", sources: S1 });
    expect(c.verifiedAt).toBeNull();
    const confirmed = await updateClientContact(user, c.id, { knowledgeStatus: "CONFIRMED", toResolve: null });
    expect(confirmed.verifiedAt).not.toBeNull();
    const typo = await updateClientContact(user, c.id, { context: "אחראית חשבונות" });
    expect(typo.verifiedAt).toEqual(confirmed.verifiedAt);
    const again = await updateClientContact(user, c.id, { sources: [...S1, ...S2] });
    expect(again.verifiedAt!.getTime()).toBeGreaterThanOrEqual(confirmed.verifiedAt!.getTime());
    expect(again.verifiedAt).not.toEqual(confirmed.verifiedAt);
  });

  it("keeps a contact's missing fields", async () => {
    const { client, user } = await setup();
    const c = await addClientContact(user, { clientId: client.id, name: "גיא", sources: S1, fieldStatus: fieldStatusFrom("CONTACT", ["emails", "bogus"], "לבקש מגיא") });
    expect(c.fieldStatus).toEqual({ emails: { status: "MISSING", toResolve: "לבקש מגיא" } });
  });

  it("keeps what the rules said when a procedure was approved", async () => {
    const { client, user, admin } = await setup();
    const p = await addProcess(user, { clientId: client.id, title: "תשלומי ספקים", sources: S1 });
    await saveProcessVersion(user, p.id, { steps: [{ title: "להעלות" }], baseVersion: 0 });
    await approveProcessVersion(admin, p.id, 1);
    const v = await prisma.processVersion.findFirstOrThrow({ where: { processId: p.id, version: 1 } });
    expect(Array.isArray(v.approvalChecks)).toBe(true);
  });

  it("keeps the permission each system needs and who does it today", async () => {
    const { client, user } = await setup();
    const doka = await addSystemAccess(user, { clientId: client.id, systemName: "Doka", sources: S1 });
    const guy = await addClientContact(user, { clientId: client.id, name: "גיא", sources: S1 });
    const p = await addProcess(user, {
      clientId: client.id,
      title: "תשלומי ספקים",
      sources: S1,
      requiredSystemIds: [doka.id],
      requiredSystemPermissions: { [doka.id]: "העלאת חשבוניות", other: "x" },
      executorContactId: guy.id,
    });
    expect(p.requiredSystemPermissions).toEqual({ [doka.id]: "העלאת חשבוניות" });
    expect(p.executorContactId).toBe(guy.id);
    // A system taken off the list takes its permission with it.
    const after = await updateProcess(user, p.id, { requiredSystemIds: [], requiredSystemPermissions: { [doka.id]: "העלאת חשבוניות" } });
    expect(after.requiredSystemPermissions).toEqual({});
    await expect(updateProcess(user, p.id, { executorUserId: "nobody" })).rejects.toThrow();
  });

  it("shows a rule's earlier versions", async () => {
    const { client, user, admin } = await setup();
    const r = await addClientPolicy(user, { clientId: client.id, kind: "INFO", title: "דיווח", statement: "פעם בחודש", sources: S1 });
    await approveClientPolicy(admin, r.id);
    await updateClientPolicy(user, r.id, { statement: "פעם בשבוע" });
    const history = await policyHistory(user, client.id, [{ id: r.id, version: 2 }]);
    const past = history.get(r.id)!;
    expect(past).toHaveLength(1);
    expect(past[0]).toMatchObject({ version: 1, statement: "פעם בחודש", approvedById: admin.id });
    expect(past[0].until).not.toBeNull();
  });

  it("links one of us in the file to their user", async () => {
    const { client, user } = await setup();
    const me = await addClientContact(user, { clientId: client.id, name: "הדס", relationship: "ANKORA", userId: user.id, sources: S1 });
    expect(me.userId).toBe(user.id);
    const outside = await addClientContact(user, { clientId: client.id, name: "איילה", relationship: "PROVIDER", userId: user.id, sources: S1 });
    expect(outside.userId).toBeNull();
  });
});
