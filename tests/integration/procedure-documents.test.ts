import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { addProcess, approveProcessVersion, saveProcessVersion, updateProcess } from "@/lib/app-domain/processes";
import { addClientContact, updateClientContact } from "@/lib/app-domain/client-contacts";
import {
  approveProcedureTranslation,
  clientProcedurePack,
  procedureDocument,
  saveProcedureTranslation,
  translationSource,
} from "@/lib/app-domain/procedure-documents";

// The procedure as a document (23.10.2026) against a real database. What
// is worth holding: an approved version reads the same after the process
// changes (the auditor asks for version 1 and gets version 1); English
// leaves only after a manager approves a complete translation; a sensitive
// process never goes to Claude; and nobody off the client reads any of it.

const S1 = [{ code: "S1" }];

async function setup() {
  const client = await createTestClient({ name: "NUX" });
  const { user: hadas } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: ariel } = await createTestUser({ role: "ANKORA_ADMIN" });
  const { user: stranger } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  await prisma.userClientAccess.create({ data: { userId: hadas.id, clientId: client.id } });
  await addClientSource(hadas, { clientId: client.id, kind: "TRANSCRIPT", title: "Kickoff" });
  const p1 = await addProcess(hadas, {
    clientId: client.id,
    title: "ניהול משתמשים",
    purpose: "פתיחה וסגירה של משתמשים",
    scope: "כל העובדים",
    controlRefs: ["CC6.2", "cc6.2", "bad<>"],
    ownerId: hadas.id,
    triggerKinds: ["EVENT"],
    reviewEveryDays: 365,
    sources: S1,
  });
  await saveProcessVersion(hadas, p1.id, { steps: [{ title: "לאסוף פרטים", output: "שם ותפקיד" }], baseVersion: 0 });
  await approveProcessVersion(ariel, p1.id, 1);
  return { client, hadas, ariel, stranger, p1 };
}

const english = {
  title: "User management",
  purpose: "Opening and closing users",
  scope: "All employees",
  owner: "Hadas",
  steps: [{ title: "Collect details", output: "Name and role" }],
};

describe("procedure documents", () => {
  it("freezes the document at approval, so version 1 does not change when the process does", async () => {
    const { hadas, p1 } = await setup();
    const row = await prisma.process.findUniqueOrThrow({ where: { id: p1.id } });
    expect(row.controlRefs).toEqual(["CC6.2"]);

    const before = await procedureDocument(hadas, p1.id);
    expect(before.doc.liveNote).toBeNull();
    expect(before.doc.title).toBe("ניהול משתמשים");

    await updateProcess(hadas, p1.id, { title: "שם חדש", scope: "רק ישראל" });
    const after = await procedureDocument(hadas, p1.id, { version: 1 });
    expect(after.doc.title).toBe("ניהול משתמשים");
    expect(JSON.stringify(after.doc.blocks)).toContain("כל העובדים");
    expect(after.fingerprint).toBe(before.fingerprint);
  });

  it("is not readable by someone who is not on the client", async () => {
    const { stranger, p1, client } = await setup();
    await expect(procedureDocument(stranger, p1.id)).rejects.toThrow();
    await expect(clientProcedurePack(stranger, client.id, "he")).rejects.toThrow();
  });

  it("exports English only after a manager approves a complete translation", async () => {
    const { hadas, ariel, p1, client } = await setup();
    await expect(procedureDocument(hadas, p1.id, { lang: "en" })).rejects.toThrow();

    const partial = await saveProcedureTranslation(hadas, p1.id, 1, { ...english, scope: null });
    expect(partial.gaps).toContain("scope");
    await expect(approveProcedureTranslation(ariel, p1.id, 1)).rejects.toThrow(/לא שלם/);

    const full = await saveProcedureTranslation(hadas, p1.id, 1, english);
    expect(full.gaps).toEqual([]);
    await expect(approveProcedureTranslation(hadas, p1.id, 1)).rejects.toThrow(/מנהל/);
    await approveProcedureTranslation(ariel, p1.id, 1);

    const en = await procedureDocument(hadas, p1.id, { lang: "en" });
    expect(en.doc.title).toBe("User management");
    const pack = await clientProcedurePack(hadas, client.id, "en");
    expect(pack.docs).toHaveLength(1);

    // A new save is a new draft: approval does not carry over.
    await saveProcedureTranslation(hadas, p1.id, 1, { ...english, title: "Users" });
    await expect(procedureDocument(hadas, p1.id, { lang: "en" })).rejects.toThrow();
  });

  it("never sends a sensitive process to Claude", async () => {
    const { hadas, ariel, client } = await setup();
    const secret = await addProcess(hadas, { clientId: client.id, title: "פרט רפואי", sensitivity: "SENSITIVE", triggerKinds: ["ON_DEMAND"], sources: S1 });
    await saveProcessVersion(hadas, secret.id, { steps: [{ title: "שלב" }], baseVersion: 0 });
    await approveProcessVersion(ariel, secret.id, 1);
    await expect(translationSource(hadas, secret.id)).rejects.toThrow(/not sent to Claude/);
  });

  // A contact marked sensitive after the version was approved
  // (25.10.2026). The rule that keeps such a contact out of a document
  // used to be enforced once, in the query inside buildSnapshot, at the
  // moment of approval. Everything below is what that left open.
  describe("a contact marked sensitive after the version was approved", () => {
    async function withContact() {
      const { hadas, ariel, client } = await setup();
      const contact = await addClientContact(hadas, {
        clientId: client.id,
        name: "רינת כהן",
        role: "מנהלת משרד",
        sources: S1,
      });
      const p = await addProcess(hadas, {
        clientId: client.id,
        title: "קליטת עובד",
        purpose: "פתיחת גישות",
        ownerId: hadas.id,
        triggerKinds: ["EVENT"],
        executorContactId: contact.id,
        sources: S1,
      });
      await saveProcessVersion(hadas, p.id, { steps: [{ title: "שלב" }], baseVersion: 0 });
      await approveProcessVersion(ariel, p.id, 1);
      return { hadas, ariel, client, contact, p };
    }

    it("names the contact while the mark is not there", async () => {
      const { hadas, p } = await withContact();
      const view = await procedureDocument(hadas, p.id);
      expect(JSON.stringify(view.doc)).toContain("רינת כהן");
    });

    it("takes the name out of a version approved before the mark, and says so", async () => {
      const { hadas, contact, p } = await withContact();
      const before = await procedureDocument(hadas, p.id);

      await updateClientContact(hadas, contact.id, { sensitivity: "SENSITIVE" });

      const after = await procedureDocument(hadas, p.id);
      const text = JSON.stringify(after.doc);
      expect(text).not.toContain("רינת כהן");
      expect(text).toContain("הושמט");
      // The bytes really changed, so the fingerprint an auditor checks
      // against the system changes with them.
      expect(after.fingerprint).not.toBe(before.fingerprint);
    });

    it("does the same for a contact kept to a few people, and for one deleted", async () => {
      const restricted = await withContact();
      await updateClientContact(restricted.hadas, restricted.contact.id, { audience: "RESTRICTED", audienceUserIds: [] });
      expect(JSON.stringify((await procedureDocument(restricted.hadas, restricted.p.id)).doc)).not.toContain("רינת כהן");

      const removed = await withContact();
      await prisma.clientContact.update({ where: { id: removed.contact.id }, data: { deletedAt: new Date() } });
      expect(JSON.stringify((await procedureDocument(removed.hadas, removed.p.id)).doc)).not.toContain("רינת כהן");
    });

    it("does not hand the name to Claude either", async () => {
      const { hadas, contact, p } = await withContact();
      expect(JSON.stringify(await translationSource(hadas, p.id))).toContain("רינת כהן");

      await updateClientContact(hadas, contact.id, { sensitivity: "SENSITIVE" });
      // canSendToAi answers for the process. It says nothing about the
      // people named inside it, and a Claude conversation is a copy
      // outside the product.
      expect(JSON.stringify(await translationSource(hadas, p.id))).not.toContain("רינת כהן");
    });

    it("keeps the name out of the auditor's single file too", async () => {
      const { hadas, contact, client, p } = await withContact();
      expect(JSON.stringify(await clientProcedurePack(hadas, client.id, "he"))).toContain("רינת כהן");

      await updateClientContact(hadas, contact.id, { sensitivity: "SENSITIVE" });
      const pack = await clientProcedurePack(hadas, client.id, "he");
      expect(JSON.stringify(pack)).not.toContain("רינת כהן");
      // And the procedure is still in the file, rather than dropping out
      // of the auditor's pack because one line changed.
      expect(pack.docs.length).toBeGreaterThan(0);
      void p;
    });

    it("leaves the rest of the frozen version exactly as it was", async () => {
      const { hadas, contact, p } = await withContact();
      const before = await procedureDocument(hadas, p.id);
      await updateClientContact(hadas, contact.id, { sensitivity: "SENSITIVE" });
      const after = await procedureDocument(hadas, p.id);
      // The content of version 1 is what the approval froze. Only who may
      // be named in it is answered now instead of then.
      expect(after.doc.version).toBe(before.doc.version);
      expect(after.doc.title).toBe(before.doc.title);
      expect(JSON.stringify(after.doc)).toContain("פתיחת גישות");
    });
  });

  it("records every export", async () => {
    const { hadas, client, p1 } = await setup();
    const { recordProcedureExport } = await import("@/lib/app-domain/procedure-documents");
    await recordProcedureExport(hadas, { clientId: client.id, processId: p1.id, version: 1, lang: "he", format: "pdf", fingerprint: "x" });
    const events = await prisma.auditEvent.findMany({ where: { action: "process.document_export", entityId: p1.id } });
    expect(events).toHaveLength(1);
  });
});
