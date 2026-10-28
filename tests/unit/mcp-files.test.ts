import { beforeEach, describe, expect, it, vi } from "vitest";

// MCP document files (12.10.2026): the tickets behind /api/mcp/files.
//
// A ticket is a credential in a URL, used by a shell that holds no session.
// So the checks here are the security story, and each would be invisible in
// manual testing: an address that worked twice, after its 15 minutes, after
// "log out everywhere", for a suspended person, or for a document on a
// client the person no longer works with. Prisma is mocked, as in
// tests/unit/mcp/auth.test.ts.

const db = vi.hoisted(() => ({
  ticket: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn(), create: vi.fn() },
  user: { findUnique: vi.fn() },
  clientDocument: { findFirst: vi.fn(), findMany: vi.fn() },
  task: { findFirst: vi.fn() },
}));
const docs = vi.hoisted(() => {
  class DriveNotConfiguredError extends Error {
    constructor() {
      super("not configured");
      this.name = "DriveNotConfiguredError";
    }
  }
  return { DriveNotConfiguredError, MAX_DOCUMENT_BYTES: 4 * 1024 * 1024, addClientDocument: vi.fn() };
});
const drive = vi.hoisted(() => ({ clientDocumentsFolder: vi.fn(() => "folder"), downloadFileFromDrive: vi.fn() }));
const audit = vi.hoisted(() => ({ recordAudit: vi.fn() }));
const clients = vi.hoisted(() => ({ listAccessibleClients: vi.fn(async () => [{ id: "c-nux" }]) }));

// 28.10.2026: "בלי AI" lookups need a database; nothing here is marked.
vi.mock("@/lib/app-domain/ai-exclusion-db", () => ({ aiExcludedTaskIds: vi.fn(async () => new Set()), aiExcludedClientIds: vi.fn(async () => new Set()), isTaskAiExcluded: vi.fn(async () => false), isDocumentAiExcluded: vi.fn(async () => false) }));
vi.mock("@/lib/prisma", () => ({
  prisma: { mcpFileTicket: db.ticket, user: db.user, clientDocument: db.clientDocument, task: db.task },
}));
vi.mock("@/lib/app-domain/client-documents", () => docs);
vi.mock("@/lib/google-drive", () => drive);
vi.mock("@/lib/app-auth/audit", () => audit);
vi.mock("@/lib/app-domain/clients", () => clients);
vi.mock("@/lib/app-auth/permissions", () => {
  class ForbiddenError extends Error {
    constructor(m: string) {
      super(m);
      this.name = "ForbiddenError";
    }
  }
  return {
    ForbiddenError,
    assertCan: vi.fn(),
    can: (role: string, permission: string) =>
      permission === "time_entry.edit_others" ? ["SUPER_ADMIN", "ANKORA_ADMIN"].includes(role) : true,
  };
});
const blank = vi.hoisted(() => ({
  blankAgreementPdf: vi.fn(async () => ({ pdf: Buffer.from("%PDF-blank"), code: "ANKORA-CONF-1.0", fileName: "ANKORA-CONF-1.0.pdf" })),
  kindFromBlankFileName: vi.fn((f: string | null) => (f === "ANKORA-CONF-1.0.pdf" ? "CONFIDENTIALITY" : null)),
}));
vi.mock("@/lib/app-domain/agreements", () => blank);

const { redeemUploadTicket, redeemDownloadTicket, issueUploadTicket } = await import("@/lib/app-domain/mcp-files");
const { generateFileTicket, hashFileTicket } = await import("@/lib/mcp/file-ticket");

const NOW = new Date("2026-10-12T08:00:00Z");
const LATER = new Date("2026-10-12T08:10:00Z");
const USER = { id: "u1", role: "ANKORA_EMPLOYEE", status: "ACTIVE", tokenVersion: 2 };
const PDF = Buffer.from("%PDF-1.4");

let ticket: string;
function uploadRow(over: Record<string, unknown> = {}) {
  return {
    id: "tk1",
    tokenHash: hashFileTicket(ticket),
    purpose: "upload",
    userId: "u1",
    tokenVersion: 2,
    clientId: "c-nux",
    taskId: "t1",
    title: "טופס 101",
    kind: "OTHER",
    fileName: "101.pdf",
    mimeType: null,
    clientVisible: false,
    documentId: null,
    expiresAt: new Date("2026-10-12T08:15:00Z"),
    usedAt: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  ticket = generateFileTicket();
  db.user.findUnique.mockResolvedValue(USER);
  db.ticket.updateMany.mockResolvedValue({ count: 1 });
  docs.addClientDocument.mockResolvedValue({ id: "doc-new", title: "טופס 101", sizeBytes: PDF.byteLength, clientVisible: false });
});

describe("redeemUploadTicket", () => {
  it("files the document exactly as the ticket described it, with the type from the extension", async () => {
    db.ticket.findUnique.mockResolvedValue(uploadRow());
    const out = await redeemUploadTicket(ticket, PDF, "application/octet-stream", LATER);
    expect(out).toMatchObject({ ok: true, status: 201 });
    // Same field and unit as upload_document and list_documents (sizeKB).
    expect(out.ok && "json" in out && out.json).toMatchObject({ filed: true, documentId: "doc-new", sizeKB: 1 });
    expect(out.ok && "json" in out && out.json).not.toHaveProperty("sizeBytes");
    expect(docs.addClientDocument).toHaveBeenCalledWith(USER, expect.objectContaining({
      clientId: "c-nux",
      taskId: "t1",
      title: "טופס 101",
      mimeType: "application/pdf",
      clientVisible: false,
    }));
    expect(db.ticket.update).toHaveBeenCalledWith({ where: { id: "tk1" }, data: { documentId: "doc-new" } });
  });

  it("claims the ticket atomically, so a second racing request files nothing", async () => {
    db.ticket.findUnique.mockResolvedValue(uploadRow());
    db.ticket.updateMany.mockResolvedValue({ count: 0 });
    const out = await redeemUploadTicket(ticket, PDF, null, LATER);
    expect(out).toMatchObject({ ok: false, status: 410 });
    expect(docs.addClientDocument).not.toHaveBeenCalled();
  });

  it("refuses a used, expired, download or unknown ticket", async () => {
    for (const row of [uploadRow({ usedAt: NOW }), uploadRow({ expiresAt: NOW }), uploadRow({ purpose: "download" }), null]) {
      db.ticket.findUnique.mockResolvedValue(row);
      expect((await redeemUploadTicket(ticket, PDF, null, LATER)).status).toBe(410);
    }
    expect(docs.addClientDocument).not.toHaveBeenCalled();
  });

  it("refuses a malformed ticket without touching the database", async () => {
    expect((await redeemUploadTicket("ank_fil_short", PDF, null, LATER)).status).toBe(410);
    expect(db.ticket.findUnique).not.toHaveBeenCalled();
  });

  it("is dead after 'log out everywhere', and for a suspended person", async () => {
    for (const user of [{ ...USER, tokenVersion: 3 }, { ...USER, status: "SUSPENDED" }, { ...USER, role: "CLIENT_USER" }]) {
      db.ticket.findUnique.mockResolvedValue(uploadRow());
      db.user.findUnique.mockResolvedValue(user);
      expect((await redeemUploadTicket(ticket, PDF, null, LATER)).status).toBe(410);
    }
    expect(docs.addClientDocument).not.toHaveBeenCalled();
  });

  it("refuses an empty body and a file over 4MB without spending the ticket", async () => {
    db.ticket.findUnique.mockResolvedValue(uploadRow());
    expect((await redeemUploadTicket(ticket, Buffer.alloc(0), null, LATER)).status).toBe(400);
    expect((await redeemUploadTicket(ticket, Buffer.alloc(4 * 1024 * 1024 + 1), null, LATER)).status).toBe(413);
    expect(db.ticket.updateMany).not.toHaveBeenCalled();
  });

  it("releases the ticket when storing fails, so the same address can be retried", async () => {
    db.ticket.findUnique.mockResolvedValue(uploadRow());
    docs.addClientDocument.mockRejectedValue(new Error("Drive 500"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await redeemUploadTicket(ticket, PDF, null, LATER);
    spy.mockRestore();
    expect(out).toMatchObject({ ok: false, status: 502 });
    expect(db.ticket.update).toHaveBeenCalledWith({ where: { id: "tk1" }, data: { usedAt: null } });
  });
});

describe("issueUploadTicket", () => {
  it("refuses a client the person does not work on, before issuing anything", async () => {
    clients.listAccessibleClients.mockResolvedValueOnce([{ id: "c-other" }]);
    await expect(
      issueUploadTicket(USER as never, { clientId: "c-nux", taskId: null, title: "x", kind: "OTHER", fileName: "x.pdf", clientVisible: false })
    ).rejects.toMatchObject({ name: "ForbiddenError" });
    expect(db.ticket.create).not.toHaveBeenCalled();
  });

  it("stores the hash and the person's token version, never the ticket itself", async () => {
    db.task.findFirst.mockResolvedValue({ id: "t1" });
    const { ticket: issued } = await issueUploadTicket(
      USER as never,
      { clientId: "c-nux", taskId: "t1", title: " x ", kind: "CONTRACT", fileName: "../x.pdf", clientVisible: false },
      NOW
    );
    const data = db.ticket.create.mock.calls[0][0].data;
    expect(data.tokenHash).toBe(hashFileTicket(issued));
    expect(JSON.stringify(data)).not.toContain(issued);
    expect(data).toMatchObject({ purpose: "upload", tokenVersion: 2, title: "x", fileName: "x.pdf" });
  });
});

describe("redeemDownloadTicket", () => {
  const downloadRow = (over: Record<string, unknown> = {}) => uploadRow({ purpose: "download", documentId: "doc-1", ...over });

  beforeEach(() => {
    db.clientDocument.findFirst.mockResolvedValue({ id: "doc-1", clientId: "c-nux", driveFileId: "drive-1", mimeType: "application/pdf", title: "טופס 101" });
    drive.downloadFileFromDrive.mockResolvedValue({ ok: true, body: new ArrayBuffer(8) });
  });

  it("returns the bytes and records the read once", async () => {
    db.ticket.findUnique.mockResolvedValue(downloadRow());
    const out = await redeemDownloadTicket(ticket, LATER);
    expect(out).toMatchObject({ ok: true, status: 200, mimeType: "application/pdf" });
    expect(audit.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "client_document.read", entityId: "doc-1" }));

    db.ticket.findUnique.mockResolvedValue(downloadRow({ usedAt: LATER }));
    audit.recordAudit.mockClear();
    expect((await redeemDownloadTicket(ticket, LATER)).status).toBe(200);
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it("stops working once the person no longer has the client", async () => {
    db.ticket.findUnique.mockResolvedValue(downloadRow());
    clients.listAccessibleClients.mockResolvedValueOnce([]);
    expect((await redeemDownloadTicket(ticket, LATER)).status).toBe(410);
    expect(drive.downloadFileFromDrive).not.toHaveBeenCalled();
  });

  it("will not download with an upload ticket, or after it expires", async () => {
    db.ticket.findUnique.mockResolvedValue(uploadRow());
    expect((await redeemDownloadTicket(ticket, LATER)).status).toBe(410);
    db.ticket.findUnique.mockResolvedValue(downloadRow({ expiresAt: NOW }));
    expect((await redeemDownloadTicket(ticket, LATER)).status).toBe(410);
  });
});

describe("redeemDownloadTicket for a blank agreement form", () => {
  const blankRow = (over: Record<string, unknown> = {}) =>
    uploadRow({ purpose: "agreement-blank", documentId: null, fileName: "ANKORA-CONF-1.0.pdf", ...over });

  it("renders the form for a manager or admin, as a PDF named by its code", async () => {
    db.ticket.findUnique.mockResolvedValue(blankRow());
    db.user.findUnique.mockResolvedValue({ ...USER, role: "ANKORA_ADMIN" });
    const out = await redeemDownloadTicket(ticket, LATER);
    expect(out).toMatchObject({ ok: true, status: 200, mimeType: "application/pdf", fileName: "ANKORA-CONF-1.0.pdf" });
    expect(blank.blankAgreementPdf).toHaveBeenCalledWith("CONFIDENTIALITY");
    expect(drive.downloadFileFromDrive).not.toHaveBeenCalled();
  });

  it("refuses when the person is no longer a manager or admin, or the ticket expired", async () => {
    db.ticket.findUnique.mockResolvedValue(blankRow());
    db.user.findUnique.mockResolvedValue({ ...USER, role: "ANKORA_EMPLOYEE" });
    expect((await redeemDownloadTicket(ticket, LATER)).status).toBe(410);
    db.ticket.findUnique.mockResolvedValue(blankRow({ expiresAt: NOW }));
    db.user.findUnique.mockResolvedValue({ ...USER, role: "ANKORA_ADMIN" });
    expect((await redeemDownloadTicket(ticket, LATER)).status).toBe(410);
    expect(blank.blankAgreementPdf).not.toHaveBeenCalled();
  });
});
