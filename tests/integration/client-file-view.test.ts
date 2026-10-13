import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { addClientContact } from "@/lib/app-domain/client-contacts";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { addClientFact } from "@/lib/app-domain/client-facts";
import { addSystemAccess } from "@/lib/app-domain/system-map";
import { buildClientFile } from "@/lib/app-domain/client-file-view";
import { toMarkdown } from "@/lib/client-file-document";

// Org brain, phase 2 (claude/org-brain-spec-2026-10-12.md, 6.1 and 6.3).
//
// What is worth holding here: the version for Claude carries no contact
// details and nothing sensitive, nobody's version carries what their
// audience hides, and section 15 gathers every unconfirmed item by itself.

async function setup() {
  const client = await createTestClient({ name: "NUX" });
  const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  await prisma.userClientAccess.create({ data: { userId: user.id, clientId: client.id } });
  await addClientSource(user, { clientId: client.id, kind: "TRANSCRIPT", title: "Nextage & Ankora" });
  return { client, user };
}

const S1 = [{ code: "S1", at: "08:13" }];

describe("client file document", () => {
  it("the version for Claude has no contact details and nothing sensitive", async () => {
    const { client, user } = await setup();
    await addClientContact(user, { clientId: client.id, name: "שני הלוי", role: "VP Finance", emails: ["shani@nextage.co.il"], phones: ["054-1234567"], sources: S1 });
    await addClientFact(user, { clientId: client.id, kind: "NOTE", body: "פרט רפואי על המנכ״ל", sensitivity: "SENSITIVE", sources: S1 });
    await addSystemAccess(user, { clientId: client.id, systemName: "Mercury", cardLast4: "4242", sources: S1 });

    const staff = toMarkdown(await buildClientFile(user, client.id, { audience: "staff" }));
    expect(staff).toContain("shani@nextage.co.il");
    expect(staff).toContain("פרט רפואי");
    expect(staff).toContain("****4242");

    const ai = toMarkdown(await buildClientFile(user, client.id, { audience: "ai" }));
    expect(ai).toContain("שני הלוי");
    expect(ai).toContain("[S1 08:13]");
    expect(ai).not.toContain("shani@nextage.co.il");
    expect(ai).not.toContain("+972541234567");
    expect(ai).not.toContain("פרט רפואי");
    expect(ai).not.toContain("4242");
  });

  it("a restricted item is missing from the file of whoever is not named", async () => {
    const { client, user } = await setup();
    const { user: colleague } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await prisma.userClientAccess.create({ data: { userId: colleague.id, clientId: client.id } });
    await addClientFact(user, { clientId: client.id, kind: "NOTE", body: "שוקלים למכור את החברה", audience: "RESTRICTED", audienceUserIds: [user.id], sources: S1 });

    expect(toMarkdown(await buildClientFile(user, client.id, { audience: "staff" }))).toContain("שוקלים למכור");
    expect(toMarkdown(await buildClientFile(colleague, client.id, { audience: "staff" }))).not.toContain("שוקלים למכור");
  });

  it("section 15 gathers every unconfirmed item, and the legend explains the codes", async () => {
    const { client, user } = await setup();
    await addClientFact(user, { clientId: client.id, kind: "FINANCE", body: "מגבלת Justworks: 25,000$", knowledgeStatus: "UNCERTAIN", toResolve: "אישור בכתב", sources: S1 });
    await addSystemAccess(user, { clientId: client.id, systemName: "Gusto", knowledgeStatus: "MISSING", toResolve: "לברר מי האדמין" });
    const doc = await buildClientFile(user, client.id, { audience: "staff" });
    const pending = doc.sections.find((s) => s.number === "15")!;
    expect(pending.items.map((i) => i.text).sort()).toEqual(["Gusto", "מגבלת Justworks: 25,000$"]);
    expect(doc.legend).toEqual([{ code: "S1", title: "Nextage & Ankora", details: "הקלטה" }]);
    // Section 16 is the audit trail of the file itself.
    expect(doc.sections.find((s) => s.number === "16")!.items.length).toBeGreaterThan(0);
  });

  it("is closed to anyone not assigned to the client", async () => {
    const { client } = await setup();
    const { user: stranger } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await expect(buildClientFile(stranger, client.id, { audience: "ai" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
