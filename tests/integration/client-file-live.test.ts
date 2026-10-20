import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { addSystemAccess, removeSystemAccess } from "@/lib/app-domain/system-map";
import { addClientFact, removeClientFact } from "@/lib/app-domain/client-facts";
import { addClientPolicy } from "@/lib/app-domain/client-policies";
import { clientBrief, clientFileChanges } from "@/lib/app-domain/client-file-live";

// The file stays in Ankora; Claude reads what changed since it last read.
// What it may not be sent never shows, not even as "removed".

const S1 = [{ code: "S1" }];

async function setup() {
  const client = await createTestClient({ name: "NUX" });
  const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  await prisma.userClientAccess.create({ data: { userId: user.id, clientId: client.id } });
  await addClientSource(user, { clientId: client.id, kind: "PERSON", title: "הדס" });
  return { client, user };
}

describe("the file, live", () => {
  it("says what changed since, and what left, without what is sensitive", async () => {
    const { client, user } = await setup();
    const old = await addSystemAccess(user, { clientId: client.id, systemName: "Doka", sources: S1 });
    await prisma.systemAccess.update({ where: { id: old.id }, data: { updatedAt: new Date("2026-09-01T00:00:00Z") } });
    const since = new Date(Date.now() - 60_000);
    await addClientPolicy(user, { clientId: client.id, kind: "INFO", title: "דיווח", statement: "פעם בחודש", sources: S1 });
    const mercury = await addSystemAccess(user, { clientId: client.id, systemName: "Mercury", sources: S1 });
    await removeSystemAccess(user, mercury.id);
    const secret = await addClientFact(user, { clientId: client.id, kind: "NOTE", body: "מידע רפואי", sensitivity: "SENSITIVE", sources: S1 });
    await removeClientFact(user, secret.id);

    const md = await clientFileChanges(user, client.id, since);
    expect(md).toContain("דיווח: פעם בחודש");
    expect(md).not.toContain("Doka");
    expect(md).toContain("מערכת: Mercury (הוסר)");
    expect(md).not.toContain("מידע רפואי");
  });

  it("a brief carries the rules", async () => {
    const { client, user } = await setup();
    await addClientPolicy(user, { clientId: client.id, kind: "INFO", title: "דיווח", statement: "פעם בחודש", sources: S1 });
    const md = await clientBrief(user, client.id);
    expect(md).toContain("# תקציר תיק: NUX");
    expect(md).toContain("דיווח");
  });

  it("refuses a client the person cannot reach", async () => {
    const { client } = await setup();
    const { user: stranger } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await expect(clientFileChanges(stranger, client.id, new Date(Date.now() - 86_400_000))).rejects.toThrow();
  });
});
