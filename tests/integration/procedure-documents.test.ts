import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { addProcess, approveProcessVersion, saveProcessVersion, updateProcess } from "@/lib/app-domain/processes";
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

  it("records every export", async () => {
    const { hadas, client, p1 } = await setup();
    const { recordProcedureExport } = await import("@/lib/app-domain/procedure-documents");
    await recordProcedureExport(hadas, { clientId: client.id, processId: p1.id, version: 1, lang: "he", format: "pdf", fingerprint: "x" });
    const events = await prisma.auditEvent.findMany({ where: { action: "process.document_export", entityId: p1.id } });
    expect(events).toHaveLength(1);
  });
});
