import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import {
  DriveNotConfiguredError,
  addClientDocument,
  listClientDocuments,
  removeClientDocument,
  setClientDocumentVisibility,
} from "@/lib/app-domain/client-documents";

// The staff side of the client's file.
//
// The upload itself needs a Shared drive folder and a federated token,
// neither of which exists in a test, and mocking both would test the mock.
// What is worth holding here is everything around it: that an employee
// cannot touch a client they are not assigned to, that the size and the
// missing-folder paths refuse in words a person can act on, and that
// removing is a soft delete rather than a hole where a document was.

const ORIGINAL_FOLDER = process.env.GCP_DRIVE_FOLDER_CLIENT_DOCS;

afterEach(() => {
  if (ORIGINAL_FOLDER === undefined) delete process.env.GCP_DRIVE_FOLDER_CLIENT_DOCS;
  else process.env.GCP_DRIVE_FOLDER_CLIENT_DOCS = ORIGINAL_FOLDER;
});

async function seedDocument(clientId: string, overrides: { title?: string; clientVisible?: boolean } = {}) {
  return prisma.clientDocument.create({
    data: {
      clientId,
      title: overrides.title ?? "פוליסה",
      driveFileId: `drive-${Math.random().toString(36).slice(2)}`,
      mimeType: "application/pdf",
      clientVisible: overrides.clientVisible ?? true,
    },
  });
}

describe("addClientDocument()", () => {
  it("says the storage is not connected rather than failing on upload", async () => {
    delete process.env.GCP_DRIVE_FOLDER_CLIENT_DOCS;

    const client = await createTestClient({ name: "Client No Drive" });
    const { user: admin } = await createTestUser({ role: "SUPER_ADMIN" });

    await expect(
      addClientDocument(admin, {
        clientId: client.id,
        title: "פוליסה",
        kind: "POLICY",
        fileName: "policy.pdf",
        mimeType: "application/pdf",
        content: Buffer.from("hello"),
      })
    ).rejects.toBeInstanceOf(DriveNotConfiguredError);
  });

  it("refuses an empty file and one past the size the platform allows", async () => {
    process.env.GCP_DRIVE_FOLDER_CLIENT_DOCS = "folder-for-test";

    const client = await createTestClient({ name: "Client Sizes" });
    const { user: admin } = await createTestUser({ role: "SUPER_ADMIN" });

    const base = {
      clientId: client.id,
      title: "פוליסה",
      kind: "POLICY" as const,
      fileName: "policy.pdf",
      mimeType: "application/pdf",
    };

    await expect(addClientDocument(admin, { ...base, content: Buffer.alloc(0) })).rejects.toThrow("ריק");
    // Just over 4MB, which is the cap the Vercel request-body limit sets
    // for us rather than one we chose.
    await expect(
      addClientDocument(admin, { ...base, content: Buffer.alloc(4 * 1024 * 1024 + 1) })
    ).rejects.toThrow("4MB");
  });

  it("refuses a client this employee is not assigned to", async () => {
    process.env.GCP_DRIVE_FOLDER_CLIENT_DOCS = "folder-for-test";

    const client = await createTestClient({ name: "Client Unassigned" });
    const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });

    await expect(
      addClientDocument(employee, {
        clientId: client.id,
        title: "פוליסה",
        kind: "POLICY",
        fileName: "policy.pdf",
        mimeType: "application/pdf",
        content: Buffer.from("hello"),
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("visibility and removal", () => {
  it("hides a document from the client without deleting it", async () => {
    const client = await createTestClient({ name: "Client Visibility" });
    const { user: admin } = await createTestUser({ role: "SUPER_ADMIN" });
    const doc = await seedDocument(client.id, { title: "טיוטה" });

    const hidden = await setClientDocumentVisibility(admin, doc.id, false);
    expect(hidden.clientVisible).toBe(false);
    expect(hidden.deletedAt).toBeNull();

    // Still on Ankora's own list: hiding is about the portal, not about
    // the record.
    const listed = await listClientDocuments(admin, client.id);
    expect(listed.map((d) => d.id)).toContain(doc.id);
  });

  it("removes by soft delete, and stops listing it", async () => {
    const client = await createTestClient({ name: "Client Removal" });
    const { user: admin } = await createTestUser({ role: "SUPER_ADMIN" });
    const doc = await seedDocument(client.id, { title: "מיותר" });

    const removed = await removeClientDocument(admin, doc.id);
    expect(removed.deletedAt).not.toBeNull();

    const listed = await listClientDocuments(admin, client.id);
    expect(listed.map((d) => d.id)).not.toContain(doc.id);

    // And a second removal finds nothing rather than removing it twice.
    await expect(removeClientDocument(admin, doc.id)).rejects.toThrow("לא נמצא");
  });

  it("refuses to touch a document belonging to a client the actor cannot reach", async () => {
    const client = await createTestClient({ name: "Client Foreign Doc" });
    const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const doc = await seedDocument(client.id);

    await expect(setClientDocumentVisibility(employee, doc.id, false)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(removeClientDocument(employee, doc.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
