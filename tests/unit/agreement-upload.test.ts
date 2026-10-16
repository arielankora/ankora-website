import { beforeEach, describe, expect, it, vi } from "vitest";

// The personal upload link for a signed agreement PDF (16.10.2026): the
// email carries a link, the employee uploads the signed PDF on a public
// page, the server files it on the internal client, and an agent verifies
// it and records it. Every edge is mocked; what is under test is what the
// domain refuses, what it files and where, and that it never records a
// signature on its own.

const db = {
  agreementSignLink: { findUnique: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  clientDocument: { findMany: vi.fn() },
  employeeAgreement: { findMany: vi.fn(), create: vi.fn() },
  user: { findFirst: vi.fn() },
  $transaction: vi.fn(),
};
vi.mock("@/lib/prisma", () => ({ prisma: db }));

const recordAudit = vi.fn();
vi.mock("@/lib/app-auth/audit", () => ({ recordAudit: (a: unknown) => recordAudit(a) }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/agreement-pdf", () => ({ renderAgreementPdf: vi.fn(), renderBlankAgreementPdf: vi.fn() }));

const upload = vi.fn();
let folder: string | null = "agreements-folder";
vi.mock("@/lib/google-drive", () => ({
  employeeAgreementsFolder: () => folder,
  uploadFileToDriveFolder: (a: unknown) => upload(a),
}));

const addClientDocumentForLink = vi.fn();
vi.mock("@/lib/app-domain/client-documents", () => ({
  addClientDocumentForLink: (...a: unknown[]) => addClientDocumentForLink(...a),
}));

const extractDocumentText = vi.fn();
vi.mock("@/lib/document-text", () => ({ extractDocumentText: (...a: unknown[]) => extractDocumentText(...a) }));

const lifecycle = {
  resolveInternalClient: vi.fn(),
  openLifecycleTaskId: vi.fn(),
  onSignedPdfUploaded: vi.fn(),
  onPdfUploadDismissed: vi.fn(),
};
vi.mock("@/lib/app-domain/employee-lifecycle", () => lifecycle);

const {
  AgreementError,
  INVALID_UPLOAD_CODE_MESSAGE,
  dismissPdfUpload,
  issueAgreementUploadCode,
  viewUploadCode,
  viewUploadLink,
  uploadSignedPdfWithCode,
  uploadSignedPdfWithLink,
  pendingPdfUploads,
} = await import("@/lib/app-domain/agreements");
const {
  CURRENT_AGREEMENTS,
  UPLOAD_CODE_ALPHABET,
  hashUploadCode,
  newUploadCode,
  normalizeUploadCode,
  hashSignToken,
  linkStateFor, looksLikePdf, lifecycleKindFor, textHasAgreementCode, MAX_SIGNED_PDF_BYTES } =
  await import("@/lib/agreements");
const { ForbiddenError } = await import("@/lib/app-auth/permissions");

const PDF = Buffer.from("%PDF-1.7\nsigned");
// A legacy upload link token: long, as the real ones are.
const TOKEN = "x".repeat(43);
const admin = { id: "admin", role: "ANKORA_ADMIN" } as never;

function link(o: Record<string, unknown> = {}) {
  return {
    id: "l1",
    userId: "emp",
    kind: "CONFIDENTIALITY",
    version: CURRENT_AGREEMENTS.CONFIDENTIALITY,
    purpose: "PDF_UPLOAD",
    usedAt: null,
    documentId: null,
    expiresAt: new Date(Date.now() + 60_000),
    user: { id: "emp", name: "נועה לוי", deletedAt: null },
    ...o,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  folder = "agreements-folder";
  db.$transaction.mockImplementation(async (ops: unknown[]) => Promise.all(ops));
  db.agreementSignLink.updateMany.mockResolvedValue({ count: 1 });
  db.agreementSignLink.create.mockResolvedValue({ id: "l1" });
  lifecycle.resolveInternalClient.mockResolvedValue({ id: "internal", name: "Ankora פנימי" });
  lifecycle.openLifecycleTaskId.mockResolvedValue("task-onb");
  addClientDocumentForLink.mockResolvedValue({ id: "doc-1" });
  extractDocumentText.mockResolvedValue({ kind: "text", text: "... ANKORA-CONF-1.0 · page 1/3 ...", truncated: false });
  upload.mockResolvedValue({ ok: true, fileId: "copy" });
});

describe("pure helpers", () => {
  it("knows a PDF by its first bytes, not by its name", () => {
    expect(looksLikePdf(PDF)).toBe(true);
    expect(looksLikePdf(Buffer.from("PK\u0003\u0004docx"))).toBe(false);
    expect(looksLikePdf(Buffer.from("%PD"))).toBe(false);
    expect(MAX_SIGNED_PDF_BYTES).toBe(4 * 1024 * 1024);
  });

  it("puts each agreement on its lifecycle task", () => {
    expect(lifecycleKindFor("CONFIDENTIALITY")).toBe("ONBOARDING");
    expect(lifecycleKindFor("DELETION_DECLARATION")).toBe("OFFBOARDING");
  });

  it("finds the code through spacing and direction marks, and only the exact code", () => {
    expect(textHasAgreementCode("‫ANKORA-CONF-1.0 · page 1/2‬", "ANKORA-CONF-1.0")).toBe(true);
    expect(textHasAgreementCode("ANKORA- CONF-1.0", "ANKORA-CONF-1.0")).toBe(true);
    expect(textHasAgreementCode("ANKORA-CONF-0.9", "ANKORA-CONF-1.0")).toBe(false);
    expect(textHasAgreementCode("ANKORA-DEL-1.0", "ANKORA-CONF-1.0")).toBe(false);
  });

  it("treats a link of the other purpose as missing, so an upload link cannot sign and the reverse", () => {
    const future = new Date(Date.now() + 60_000);
    expect(linkStateFor({ purpose: "PDF_UPLOAD", usedAt: null, expiresAt: future }, "PDF_UPLOAD")).toBe("valid");
    expect(linkStateFor({ purpose: "APP_SIGN", usedAt: null, expiresAt: future }, "PDF_UPLOAD")).toBe("missing");
    expect(linkStateFor({ purpose: "PDF_UPLOAD", usedAt: null, expiresAt: future }, "APP_SIGN")).toBe("missing");
    expect(linkStateFor({ purpose: "PDF_UPLOAD", usedAt: new Date(), expiresAt: future }, "PDF_UPLOAD")).toBe("used");
    expect(linkStateFor({ purpose: "PDF_UPLOAD", usedAt: null, expiresAt: new Date(0) }, "PDF_UPLOAD")).toBe("expired");
    expect(linkStateFor(null, "PDF_UPLOAD")).toBe("missing");
  });
});

describe("upload codes", () => {
  it("are 8 characters from the unambiguous alphabet, shown as XXXX-XXXX", () => {
    expect(UPLOAD_CODE_ALPHABET).not.toMatch(/[0O1IL]/);
    for (let i = 0; i < 200; i++) {
      const code = newUploadCode();
      expect(code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/);
    }
    expect(new Set(Array.from({ length: 50 }, newUploadCode)).size).toBe(50);
  });

  it("normalize case, spaces and dashes before hashing, and refuse what cannot be a code", () => {
    expect(normalizeUploadCode(" k7qm 3xrb ")).toBe("K7QM3XRB");
    expect(normalizeUploadCode("K7QM" + String.fromCharCode(0x2013) + "3XRB")).toBe("K7QM3XRB");
    expect(hashUploadCode("k7qm-3xrb")).toBe(hashUploadCode("K7QM3XRB"));
    expect(hashUploadCode("K7QM-3XRB")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashUploadCode("K7QM-3XR")).toBeNull(); // too short
    expect(hashUploadCode("K7QM-3XR0")).toBeNull(); // 0 is not in the alphabet
  });
});

describe("issueAgreementUploadCode", () => {
  it("is for managers and admins only", async () => {
    await expect(issueAgreementUploadCode({ id: "e", role: "ANKORA_EMPLOYEE" } as never, "emp", "CONFIDENTIALITY")).rejects.toBeInstanceOf(
      ForbiddenError
    );
    expect(db.agreementSignLink.create).not.toHaveBeenCalled();
  });

  it("is for Ankora staff only", async () => {
    db.user.findFirst.mockResolvedValue({ id: "c", role: "CLIENT_USER" });
    await expect(issueAgreementUploadCode(admin, "c", "CONFIDENTIALITY")).rejects.toBeInstanceOf(AgreementError);
  });

  it("stores only the hash of the code, lives 7 days, revokes earlier unused ones and names the page", async () => {
    db.user.findFirst.mockResolvedValue({ id: "emp", role: "ANKORA_EMPLOYEE" });
    const out = await issueAgreementUploadCode(admin, "emp", "CONFIDENTIALITY");
    expect(out.uploadCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(out.uploadPageUrl).toMatch(/\/upload$/);
    expect(out.uploadPageUrl).not.toContain(normalizeUploadCode(out.uploadCode));
    const data = db.agreementSignLink.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ userId: "emp", kind: "CONFIDENTIALITY", purpose: "PDF_UPLOAD", tokenHash: hashUploadCode(out.uploadCode), createdById: "admin" });
    expect(JSON.stringify(data)).not.toContain(normalizeUploadCode(out.uploadCode));
    expect(out.expiresAt.getTime() - Date.now()).toBeGreaterThan(6.9 * 24 * 3600_000);
    expect(out).toMatchObject({ version: CURRENT_AGREEMENTS.CONFIDENTIALITY, agreementCode: "ANKORA-CONF-1.0" });
    expect(db.agreementSignLink.updateMany.mock.calls[0][0].where).toEqual({
      userId: "emp",
      kind: "CONFIDENTIALITY",
      purpose: "PDF_UPLOAD",
      usedAt: null,
    });
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "agreement.upload_code_issued" }));
  });
});

describe("viewUploadCode and uploadSignedPdfWithCode", () => {
  it("show the title and the first name only for a valid code", async () => {
    db.agreementSignLink.findUnique.mockResolvedValue(link());
    const view = await viewUploadCode("k7qm 3xrb");
    expect(view).toEqual({ title: expect.any(String), firstName: "נועה", version: CURRENT_AGREEMENTS.CONFIDENTIALITY, agreementCode: "ANKORA-CONF-1.0" });
    expect(db.agreementSignLink.findUnique.mock.calls[0][0].where).toEqual({ tokenHash: hashUploadCode("K7QM-3XRB") });
  });

  it("give one generic answer for a malformed, unknown, used or expired code", async () => {
    expect(await viewUploadCode("nope")).toBeNull();
    expect(db.agreementSignLink.findUnique).not.toHaveBeenCalled();
    const messages = new Set<string>();
    for (const row of [null, link({ usedAt: new Date() }), link({ expiresAt: new Date(0) })]) {
      db.agreementSignLink.findUnique.mockResolvedValueOnce(row);
      messages.add(await uploadSignedPdfWithCode("K7QM-3XRB", { content: PDF, fileName: "a.pdf" }).catch((e) => e.message));
    }
    messages.add(await uploadSignedPdfWithCode("bad", { content: PDF, fileName: "a.pdf" }).catch((e) => e.message));
    expect([...messages]).toEqual([INVALID_UPLOAD_CODE_MESSAGE]);
    expect(addClientDocumentForLink).not.toHaveBeenCalled();
  });

  it("file the PDF exactly as the link did, checking the code again on submit", async () => {
    db.agreementSignLink.findUnique.mockResolvedValue(link());
    const out = await uploadSignedPdfWithCode("K7QM-3XRB", { content: PDF, fileName: "s.pdf" });
    expect(out).toEqual({ documentId: "doc-1", codeFound: true });
    expect(db.agreementSignLink.findUnique.mock.calls[0][0].where).toEqual({ tokenHash: hashUploadCode("K7QM-3XRB") });
    expect(addClientDocumentForLink.mock.calls[0][0]).toMatchObject({ clientId: "internal", clientVisible: false });
  });
});

describe("the legacy upload link", () => {
  it("still works for long tokens already issued, and refuses short ones so codes cannot be tried there", async () => {
    db.agreementSignLink.findUnique.mockResolvedValue(link());
    expect(await viewUploadLink(TOKEN)).toMatchObject({ code: "ANKORA-CONF-1.0" });
    expect(db.agreementSignLink.findUnique.mock.calls[0][0].where).toEqual({ tokenHash: hashSignToken(TOKEN) });
    db.agreementSignLink.findUnique.mockClear();
    expect(await viewUploadLink("K7QM3XRB")).toBeNull();
    await expect(uploadSignedPdfWithLink("K7QM3XRB", { content: PDF, fileName: "a.pdf" })).rejects.toBeInstanceOf(AgreementError);
    expect(db.agreementSignLink.findUnique).not.toHaveBeenCalled();
  });
});

describe("dismissPdfUpload", () => {
  it("is for managers and admins, needs a reason, and marks the upload reviewed once", async () => {
    await expect(dismissPdfUpload({ id: "e", role: "ANKORA_EMPLOYEE" } as never, "doc-1", "x")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(dismissPdfUpload(admin, "doc-1", "  ")).rejects.toBeInstanceOf(AgreementError);

    db.agreementSignLink.findFirst.mockResolvedValue({ id: "l1", userId: "emp", kind: "CONFIDENTIALITY", reviewedAt: null });
    const out = await dismissPdfUpload(admin, "doc-1", "אין חתימה גלויה");
    expect(out).toMatchObject({ documentId: "doc-1", kind: "CONFIDENTIALITY" });
    expect(db.agreementSignLink.updateMany.mock.calls.at(-1)![0]).toEqual({
      where: { userId: "emp", documentId: "doc-1", purpose: "PDF_UPLOAD", reviewedAt: null },
      data: { reviewedAt: expect.any(Date), reviewedById: "admin" },
    });
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "agreement.pdf_upload_dismissed" }));
    expect(lifecycle.onPdfUploadDismissed).toHaveBeenCalledWith("emp", "CONFIDENTIALITY", "doc-1", "אין חתימה גלויה");

    db.agreementSignLink.findFirst.mockResolvedValue({ id: "l1", userId: "emp", kind: "CONFIDENTIALITY", reviewedAt: new Date() });
    await expect(dismissPdfUpload(admin, "doc-1", "again")).rejects.toThrow(/already reviewed/);
  });
});

describe("viewUploadLink", () => {
  it("shows a valid upload link, and nothing for a sign link or a used one", async () => {
    db.agreementSignLink.findUnique.mockResolvedValueOnce(link());
    expect(await viewUploadLink(TOKEN)).toMatchObject({ userName: "נועה לוי", code: "ANKORA-CONF-1.0" });
    db.agreementSignLink.findUnique.mockResolvedValueOnce(link({ purpose: "APP_SIGN" }));
    expect(await viewUploadLink(TOKEN)).toBeNull();
    db.agreementSignLink.findUnique.mockResolvedValueOnce(link({ usedAt: new Date() }));
    expect(await viewUploadLink(TOKEN)).toBeNull();
  });
});

describe("uploadSignedPdfWithLink", () => {
  it("refuses an unknown, used, expired or sign link with one message", async () => {
    const messages = new Set<string>();
    for (const row of [null, link({ usedAt: new Date() }), link({ expiresAt: new Date(0) }), link({ purpose: "APP_SIGN" })]) {
      db.agreementSignLink.findUnique.mockResolvedValueOnce(row);
      messages.add(await uploadSignedPdfWithLink(TOKEN, { content: PDF, fileName: "a.pdf" }).catch((e) => e.message));
    }
    expect(messages.size).toBe(1);
    expect(addClientDocumentForLink).not.toHaveBeenCalled();
  });

  it("refuses a file that is not a PDF, or over 4MB, without using up the link", async () => {
    db.agreementSignLink.findUnique.mockResolvedValue(link());
    await expect(uploadSignedPdfWithLink(TOKEN, { content: Buffer.from("PK\u0003\u0004"), fileName: "a.pdf" })).rejects.toThrow(/PDF/);
    await expect(
      uploadSignedPdfWithLink(TOKEN, { content: Buffer.concat([PDF, Buffer.alloc(MAX_SIGNED_PDF_BYTES)]), fileName: "a.pdf" })
    ).rejects.toThrow(/4MB/);
    expect(db.agreementSignLink.updateMany).not.toHaveBeenCalled();
  });

  it("files it hidden on the internal client, on the open onboarding task, and notes it without recording a signature", async () => {
    db.agreementSignLink.findUnique.mockResolvedValue(link());
    const out = await uploadSignedPdfWithLink(TOKEN, { content: PDF, fileName: "signed.pdf" });
    expect(out).toEqual({ documentId: "doc-1", codeFound: true });

    expect(db.agreementSignLink.updateMany.mock.calls[0][0].where).toMatchObject({ id: "l1", usedAt: null });
    expect(lifecycle.openLifecycleTaskId).toHaveBeenCalledWith("emp", "ONBOARDING");
    const [input, uploadedBy] = addClientDocumentForLink.mock.calls[0];
    expect(input).toMatchObject({ clientId: "internal", taskId: "task-onb", kind: "CONTRACT", clientVisible: false, mimeType: "application/pdf" });
    expect(input.title).toContain("נועה לוי");
    expect(uploadedBy).toBe("emp");
    expect(db.agreementSignLink.update).toHaveBeenCalledWith({ where: { id: "l1" }, data: { documentId: "doc-1" } });
    expect(upload.mock.calls[0][0]).toMatchObject({ folderId: "agreements-folder", mimeType: "application/pdf" });
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "agreement.pdf_uploaded", actorId: "emp" }));
    expect(lifecycle.onSignedPdfUploaded).toHaveBeenCalledWith("emp", "CONFIDENTIALITY", "doc-1", true);
    expect(db.employeeAgreement.create).not.toHaveBeenCalled();
  });

  it("still files a PDF whose code is not in its text, and says so", async () => {
    db.agreementSignLink.findUnique.mockResolvedValue(link({ kind: "DELETION_DECLARATION", version: CURRENT_AGREEMENTS.DELETION_DECLARATION }));
    extractDocumentText.mockResolvedValue({ kind: "none", reason: "scan" });
    const out = await uploadSignedPdfWithLink(TOKEN, { content: PDF, fileName: "scan.pdf" });
    expect(out.codeFound).toBe(false);
    expect(lifecycle.openLifecycleTaskId).toHaveBeenCalledWith("emp", "OFFBOARDING");
    expect(lifecycle.onSignedPdfUploaded).toHaveBeenCalledWith("emp", "DELETION_DECLARATION", "doc-1", false);
  });

  it("does not fail the upload when the copy to the agreements folder fails", async () => {
    db.agreementSignLink.findUnique.mockResolvedValue(link());
    upload.mockResolvedValue({ ok: false, error: "drive down" });
    await expect(uploadSignedPdfWithLink(TOKEN, { content: PDF, fileName: "a.pdf" })).resolves.toMatchObject({ documentId: "doc-1" });
  });

  it("gives the link back when filing fails, so the person can try again", async () => {
    db.agreementSignLink.findUnique.mockResolvedValue(link());
    addClientDocumentForLink.mockRejectedValue(new Error("Drive down"));
    await expect(uploadSignedPdfWithLink(TOKEN, { content: PDF, fileName: "a.pdf" })).rejects.toThrow(/הקישור עדיין בתוקף/);
    expect(db.agreementSignLink.updateMany.mock.calls[1][0]).toEqual({ where: { id: "l1", documentId: null }, data: { usedAt: null } });
    expect(lifecycle.onSignedPdfUploaded).not.toHaveBeenCalled();
  });

  it("refuses when a second upload loses the race for the link", async () => {
    db.agreementSignLink.findUnique.mockResolvedValue(link());
    db.agreementSignLink.updateMany.mockResolvedValue({ count: 0 });
    await expect(uploadSignedPdfWithLink(TOKEN, { content: PDF, fileName: "a.pdf" })).rejects.toBeInstanceOf(AgreementError);
    expect(addClientDocumentForLink).not.toHaveBeenCalled();
  });
});

describe("pendingPdfUploads", () => {
  it("lists uploads not yet recorded as an EMAIL_PDF signature, per kind", async () => {
    db.agreementSignLink.findMany.mockResolvedValue([
      { kind: "CONFIDENTIALITY", documentId: "doc-1", usedAt: new Date("2026-10-15T08:00:00Z") },
      { kind: "CONFIDENTIALITY", documentId: "doc-2", usedAt: new Date("2026-10-16T08:00:00Z") },
    ]);
    db.clientDocument.findMany.mockResolvedValue([
      { id: "doc-1", driveFileId: "f1", createdAt: new Date() },
      { id: "doc-2", driveFileId: "f2", createdAt: new Date() },
    ]);
    db.employeeAgreement.findMany.mockResolvedValue([{ driveFileId: "f1" }]);
    const out = await pendingPdfUploads("emp");
    expect(db.agreementSignLink.findMany.mock.calls[0][0].where).toMatchObject({ documentId: { not: null }, reviewedAt: null });
    expect(out.CONFIDENTIALITY).toEqual([{ documentId: "doc-2", uploadedAt: new Date("2026-10-16T08:00:00Z") }]);
    expect(out.DELETION_DECLARATION).toEqual([]);
  });
});
