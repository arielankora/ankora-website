import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { addClientFact } from "@/lib/app-domain/client-facts";
import { buildClientFile } from "@/lib/app-domain/client-file-view";
import { daysSinceLastBatch, EXTRACTION_STALE, notifyStaleExtraction } from "@/lib/app-domain/client-control";
import { toMarkdown } from "@/lib/client-file-document";

// Org brain (claude/org-brain-spec-2026-10-12.md, 7.6; mapping gap 17).
//
// What is worth holding here: the account manager hears once when the
// extraction goes quiet for more than three business days, not for a
// client that never had it, and again only after a new batch went quiet;
// and the file opens with the control line.

const S1 = [{ code: "S1" }];

async function setup() {
  const { user: manager } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const client = await prisma.client.update({ where: { id: (await createTestClient({ name: "NUX" })).id }, data: { accountManagerId: manager.id } });
  await prisma.userClientAccess.create({ data: { userId: manager.id, clientId: client.id } });
  return { client, manager };
}

// Thursday 15.10.2026, 10:00 in Israel.
const THU = new Date("2026-10-15T07:00:00Z");
const at = (iso: string) => new Date(`${iso}T09:00:00Z`);

describe("stale extraction", () => {
  it("tells the account manager once per silence, after three business days", async () => {
    const { client, manager } = await setup();
    await prisma.knowledgeBatch.create({ data: { clientId: client.id, createdAt: THU } });

    // Sunday to Tuesday: 3 business days, still fine.
    expect(await daysSinceLastBatch(client.id, at("2026-10-20"))).toBe(3);
    expect((await notifyStaleExtraction(at("2026-10-20"))).notified).toBe(0);

    expect((await notifyStaleExtraction(at("2026-10-21"))).notified).toBe(1);
    const note = await prisma.notification.findFirstOrThrow({ where: { userId: manager.id, type: EXTRACTION_STALE } });
    expect(note.title).toContain("NUX");
    expect(note.entityId).toBe(client.id);
    // The next day: the same silence, no second notice.
    expect((await notifyStaleExtraction(at("2026-10-22"))).notified).toBe(0);

    // A new batch, and it goes quiet again: a new notice.
    await prisma.knowledgeBatch.create({ data: { clientId: client.id, createdAt: at("2026-10-22") } });
    expect((await notifyStaleExtraction(at("2026-10-25"))).notified).toBe(0);
    expect((await notifyStaleExtraction(at("2026-10-28"))).notified).toBe(1);
    expect(await prisma.notification.count({ where: { userId: manager.id, type: EXTRACTION_STALE } })).toBe(2);
  });

  it("a client that never had a batch, or has no manager, is not reminded", async () => {
    const { client } = await setup();
    const orphan = await createTestClient({ name: "בלי מנהל" });
    await prisma.knowledgeBatch.create({ data: { clientId: orphan.id, createdAt: THU } });
    expect(await daysSinceLastBatch(client.id)).toBeNull();
    expect((await notifyStaleExtraction(at("2026-11-30"))).notified).toBe(0);
  });
});

describe("the control line in the file", () => {
  it("opens the file, in both versions", async () => {
    const { client, manager } = await setup();
    await addClientSource(manager, { clientId: client.id, kind: "TRANSCRIPT", title: "Nextage & Ankora" });
    await addClientFact(manager, { clientId: client.id, kind: "QUESTION", body: "מי מאשר העברות מעל 10,000?", sources: S1 });

    const staff = await buildClientFile(manager, client.id, { audience: "staff" });
    expect(staff.control?.map((p) => p.text)).toEqual(["אין עדיין תהליכים", "שאלה פתוחה אחת", "עוד לא הגיעה אצווה מהחילוץ"]);
    const md = toMarkdown(staff);
    expect(md).toContain("**בקרה:** אין עדיין תהליכים · שאלה פתוחה אחת");
    expect(md.indexOf("**בקרה:**")).toBeLessThan(md.indexOf("## איך לקרוא את התיק"));
    expect(toMarkdown(await buildClientFile(manager, client.id, { audience: "ai" }))).toContain("**בקרה:**");
  });
});
