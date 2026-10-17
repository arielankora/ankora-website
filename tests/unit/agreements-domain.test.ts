import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/app-domain/agreements.ts with every edge mocked: the database, the
// audit trail, mail, Drive and the PDF. What is under test is the rules
// this module enforces, not the libraries behind them.

const db = {
  employeeAgreement: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  agreementSignLink: { findUnique: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
  clientDocument: { findFirst: vi.fn() },
  mcpFileTicket: { create: vi.fn() },
  user: { findFirst: vi.fn() },
  $transaction: vi.fn(),
};
vi.mock("@/lib/prisma", () => ({ prisma: db }));

const recordAudit = vi.fn();
vi.mock("@/lib/app-auth/audit", () => ({ recordAudit: (a: unknown) => recordAudit(a) }));

const sendEmail = vi.fn();
vi.mock("@/lib/email", () => ({ sendEmail: (a: unknown) => sendEmail(a) }));

const upload = vi.fn();
let folder: string | null = null;
vi.mock("@/lib/google-drive", () => ({
  employeeAgreementsFolder: () => folder,
  uploadFileToDriveFolder: (a: unknown) => upload(a),
}));

vi.mock("@/lib/agreement-pdf", () => ({ renderAgreementPdf: async () => Buffer.from("%PDF-test") }));

const onConfidentialitySigned = vi.fn();
const onDeletionDeclarationSigned = vi.fn();
const onPdfSignatureRecorded = vi.fn();
const resolveInternalClient = vi.fn();
vi.mock("@/lib/app-domain/employee-lifecycle", () => ({
  onConfidentialitySigned: (...a: unknown[]) => onConfidentialitySigned(...a),
  onDeletionDeclarationSigned: (...a: unknown[]) => onDeletionDeclarationSigned(...a),
  onPdfSignatureRecorded: (...a: unknown[]) => onPdfSignatureRecorded(...a),
  resolveInternalClient: () => resolveInternalClient(),
}));

const {
  AgreementError,
  signConfidentiality,
  signWithLink,
  issueDeletionDeclarationLink,
  recordPdfSignature,
  recordPdfSignatureFromDocument,
  issueBlankAgreementTicket,
  kindFromBlankFileName,
  getAgreementStatus,
} =
  await import("@/lib/app-domain/agreements");
const { CURRENT_AGREEMENTS, hashSignToken } = await import("@/lib/agreements");
const { ForbiddenError } = await import("@/lib/app-auth/permissions");

function user(overrides: Record<string, unknown> = {}) {
  return {
    id: "u1",
    name: "דנה כהן",
    email: "dana@ankora.co.il",
    role: "ANKORA_EMPLOYEE",
    status: "ACTIVE",
    personalEmail: "dana@example.com",
    deletedAt: null,
    ...overrides,
  } as never;
}

const signInput = (o: Record<string, unknown> = {}) => ({
  signedName: "דנה כהן",
  consent: true,
  version: CURRENT_AGREEMENTS.CONFIDENTIALITY,
  ip: "203.0.113.7",
  userAgent: "UA",
  ...o,
});

beforeEach(() => {
  vi.clearAllMocks();
  folder = null;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  db.employeeAgreement.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "a1", ...data }));
  db.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: typeof db) => unknown)(db) : Promise.all(arg as unknown[])
  );
  sendEmail.mockResolvedValue({ ok: true });
});

describe("signConfidentiality", () => {
  it("refuses a name that is not the account's, and records nothing", async () => {
    db.employeeAgreement.findFirst.mockResolvedValue(null);
    await expect(signConfidentiality(user(), signInput({ signedName: "דנה לוי" }))).rejects.toBeInstanceOf(AgreementError);
    expect(db.employeeAgreement.create).not.toHaveBeenCalled();
  });

  it("refuses without the tick, and refuses a version the page did not show", async () => {
    await expect(signConfidentiality(user(), signInput({ consent: false }))).rejects.toBeInstanceOf(AgreementError);
    await expect(signConfidentiality(user(), signInput({ version: "סודיות-0.9" }))).rejects.toBeInstanceOf(AgreementError);
  });

  it("never asks a client portal user to sign", async () => {
    await expect(signConfidentiality(user({ role: "CLIENT_USER" }), signInput())).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("records the signature with IP, browser and hash, and audits it, even with no Drive folder", async () => {
    db.employeeAgreement.findFirst.mockResolvedValue(null);
    const row = await signConfidentiality(user(), signInput({ signedName: "  דנה   כהן " }));
    const data = db.employeeAgreement.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      userId: "u1",
      kind: "CONFIDENTIALITY",
      channel: "APP",
      signedName: "דנה כהן",
      ip: "203.0.113.7",
      userAgent: "UA",
    });
    expect(data.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.id).toBe("a1");
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "agreement.sign", entityId: "a1" }));
    expect(upload).not.toHaveBeenCalled();
    expect(db.employeeAgreement.update).not.toHaveBeenCalled();
    // The onboarding task hears about it.
    expect(onConfidentialitySigned).toHaveBeenCalledWith("u1");
  });

  it("keeps the signature when the Drive upload fails, and stores the file id when it works", async () => {
    db.employeeAgreement.findFirst.mockResolvedValue(null);
    folder = "folder-1";
    upload.mockResolvedValueOnce({ ok: false, error: "boom" });
    await expect(signConfidentiality(user(), signInput())).resolves.toBeTruthy();
    expect(db.employeeAgreement.update).not.toHaveBeenCalled();

    upload.mockResolvedValueOnce({ ok: true, fileId: "drive-9" });
    await signConfidentiality(user(), signInput());
    expect(db.employeeAgreement.update).toHaveBeenCalledWith({ where: { id: "a1" }, data: { driveFileId: "drive-9" } });
    expect(upload.mock.calls[1][0]).toMatchObject({ folderId: "folder-1", mimeType: "application/pdf" });
  });

  it("returns the existing row on a second submit instead of signing twice", async () => {
    db.employeeAgreement.findFirst.mockResolvedValue({ id: "existing" });
    const row = await signConfidentiality(user(), signInput());
    expect(row.id).toBe("existing");
    expect(db.employeeAgreement.create).not.toHaveBeenCalled();
  });
});

describe("signWithLink", () => {
  const link = (o: Record<string, unknown> = {}) => ({
    id: "l1",
    userId: "u1",
    kind: "DELETION_DECLARATION",
    version: CURRENT_AGREEMENTS.DELETION_DECLARATION,
    purpose: "APP_SIGN",
    usedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    user: user({ status: "SUSPENDED" }),
    ...o,
  });
  const input = signInput({ version: CURRENT_AGREEMENTS.DELETION_DECLARATION });

  it("looks the token up by its hash", async () => {
    db.agreementSignLink.findUnique.mockResolvedValue(null);
    await expect(signWithLink("raw-token", input)).rejects.toBeInstanceOf(AgreementError);
    expect(db.agreementSignLink.findUnique.mock.calls[0][0].where).toEqual({ tokenHash: hashSignToken("raw-token") });
  });

  it("refuses a used or expired link without saying which", async () => {
    db.agreementSignLink.findUnique.mockResolvedValueOnce(link({ usedAt: new Date() }));
    const used = await signWithLink("t", input).catch((e) => e.message);
    db.agreementSignLink.findUnique.mockResolvedValueOnce(link({ expiresAt: new Date(Date.now() - 1) }));
    const expired = await signWithLink("t", input).catch((e) => e.message);
    expect(used).toBe(expired);
    expect(db.employeeAgreement.create).not.toHaveBeenCalled();
  });

  it("burns the link and writes the row in one transaction", async () => {
    db.agreementSignLink.findUnique.mockResolvedValue(link());
    db.agreementSignLink.updateMany.mockResolvedValue({ count: 1 });
    await signWithLink("t", input);
    expect(db.agreementSignLink.updateMany.mock.calls[0][0].where).toMatchObject({ id: "l1", usedAt: null });
    expect(db.employeeAgreement.create.mock.calls[0][0].data).toMatchObject({
      kind: "DELETION_DECLARATION",
      channel: "APP",
      userId: "u1",
    });
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "agreement.sign", actorId: "u1" }));
    // The offboarding task is told the declaration came back.
    expect(onDeletionDeclarationSigned).toHaveBeenCalledWith("u1", "a1");
  });

  it("treats a confidentiality signature through a link as an in-app signature for the onboarding task", async () => {
    db.agreementSignLink.findUnique.mockResolvedValue(
      link({ kind: "CONFIDENTIALITY", version: CURRENT_AGREEMENTS.CONFIDENTIALITY })
    );
    db.agreementSignLink.updateMany.mockResolvedValue({ count: 1 });
    await signWithLink("t", signInput());
    expect(onConfidentialitySigned).toHaveBeenCalledWith("u1");
    expect(onDeletionDeclarationSigned).not.toHaveBeenCalled();
  });

  it("writes nothing when a second submit loses the race for the link", async () => {
    db.agreementSignLink.findUnique.mockResolvedValue(link());
    db.agreementSignLink.updateMany.mockResolvedValue({ count: 0 });
    await expect(signWithLink("t", input)).rejects.toBeInstanceOf(AgreementError);
    expect(db.employeeAgreement.create).not.toHaveBeenCalled();
  });
});

describe("issueDeletionDeclarationLink", () => {
  const admin = user({ id: "admin", role: "SUPER_ADMIN" });

  it("is for admins only", async () => {
    await expect(issueDeletionDeclarationLink(user(), "u1")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses without a private address, and for a client", async () => {
    db.user.findFirst.mockResolvedValueOnce(user({ status: "SUSPENDED", personalEmail: null }));
    await expect(issueDeletionDeclarationLink(admin, "u1")).rejects.toThrow(/מייל פרטי/);
    db.user.findFirst.mockResolvedValueOnce(user({ role: "CLIENT_USER", status: "SUSPENDED" }));
    await expect(issueDeletionDeclarationLink(admin, "u1")).rejects.toBeInstanceOf(AgreementError);
  });

  it("asks for confirmation before sending to someone still active", async () => {
    db.user.findFirst.mockResolvedValue(user());
    await expect(issueDeletionDeclarationLink(admin, "u1")).rejects.toThrow(/פעיל/);
    db.agreementSignLink.updateMany.mockResolvedValue({ count: 0 });
    db.agreementSignLink.create.mockResolvedValue({ id: "l1", kind: "DELETION_DECLARATION", version: "מחיקה-1.0" });
    await expect(issueDeletionDeclarationLink(admin, "u1", { confirmActive: true })).resolves.toBeTruthy();
  });

  it("stores only a hash, mails the private address and audits", async () => {
    db.user.findFirst.mockResolvedValue(user({ status: "SUSPENDED" }));
    db.agreementSignLink.updateMany.mockResolvedValue({ count: 1 });
    db.agreementSignLink.create.mockResolvedValue({ id: "l1", kind: "DELETION_DECLARATION", version: "מחיקה-1.0" });

    const { url, emailSent } = await issueDeletionDeclarationLink(admin, "u1");
    const raw = url.split("/agreements/sign/")[1];
    const data = db.agreementSignLink.create.mock.calls[0][0].data;
    expect(data.tokenHash).toBe(hashSignToken(raw));
    expect(JSON.stringify(data)).not.toContain(raw);
    expect(data.expiresAt.getTime() - Date.now()).toBeGreaterThan(6.9 * 24 * 60 * 60 * 1000);
    expect(data.version).toBe(CURRENT_AGREEMENTS.DELETION_DECLARATION);
    expect(emailSent).toBe(true);
    expect(sendEmail.mock.calls[0][0].to).toEqual(["dana@example.com"]);
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "agreement.link_issued", actorId: "admin" }));
  });
});

describe("recordPdfSignature", () => {
  const admin = user({ id: "admin", role: "ANKORA_ADMIN" });
  const input = {
    userId: "u1",
    kind: "CONFIDENTIALITY" as const,
    version: CURRENT_AGREEMENTS.CONFIDENTIALITY,
    signedName: "דנה כהן",
    signedAt: new Date("2026-10-01T09:00:00Z"),
    driveFileId: "drive-1",
  };

  it("is for admins only", async () => {
    await expect(recordPdfSignature(user(), input)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses a version that does not exist", async () => {
    db.user.findFirst.mockResolvedValue(user());
    await expect(recordPdfSignature(admin, { ...input, version: "סודיות-9.9" })).rejects.toBeInstanceOf(AgreementError);
  });

  it("records an EMAIL_PDF row with who recorded it", async () => {
    db.user.findFirst.mockResolvedValue(user());
    await recordPdfSignature(admin, input);
    expect(db.employeeAgreement.create.mock.calls[0][0].data).toMatchObject({
      channel: "EMAIL_PDF",
      recordedById: "admin",
      driveFileId: "drive-1",
      ip: null,
    });
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "agreement.pdf_recorded" }));
  });
});

describe("getAgreementStatus", () => {
  it("reports each kind per channel, for the current version only, and the latest signature per channel", async () => {
    const at = new Date("2026-10-01T09:00:00Z");
    db.employeeAgreement.findMany.mockResolvedValue([
      { kind: "CONFIDENTIALITY", version: CURRENT_AGREEMENTS.CONFIDENTIALITY, channel: "APP", signedAt: at },
      { kind: "DELETION_DECLARATION", version: "מחיקה-0.1", channel: "EMAIL_PDF", signedAt: at },
    ]);
    expect(await getAgreementStatus("u1")).toEqual([
      {
        kind: "CONFIDENTIALITY",
        currentVersion: CURRENT_AGREEMENTS.CONFIDENTIALITY,
        app: true,
        emailPdf: false,
        appLatest: { version: CURRENT_AGREEMENTS.CONFIDENTIALITY, signedAt: at },
        emailPdfLatest: null,
      },
      {
        kind: "DELETION_DECLARATION",
        currentVersion: CURRENT_AGREEMENTS.DELETION_DECLARATION,
        app: false,
        emailPdf: false,
        appLatest: null,
        emailPdfLatest: { version: "מחיקה-0.1", signedAt: at },
      },
    ]);
  });
});

describe("recordPdfSignatureFromDocument (the MCP tool's domain half)", () => {
  const admin = user({ id: "admin", role: "SUPER_ADMIN" });
  const input = (o: Record<string, unknown> = {}) => ({
    userId: "u1",
    kind: "CONFIDENTIALITY" as const,
    version: CURRENT_AGREEMENTS.CONFIDENTIALITY,
    signedName: "דנה כהן",
    signedAt: new Date("2026-10-14T21:00:00Z"),
    documentId: "doc-1",
    ...o,
  });

  beforeEach(() => {
    resolveInternalClient.mockResolvedValue({ id: "internal", name: "Ankora פנימי" });
    db.clientDocument.findFirst.mockResolvedValue({ id: "doc-1", clientId: "internal", driveFileId: "drive-7" });
    db.user.findFirst.mockResolvedValue(user());
    db.employeeAgreement.findFirst.mockResolvedValue(null);
  });

  it("is for admins only", async () => {
    await expect(recordPdfSignatureFromDocument(user(), input())).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses a version other than the current one, naming the expected version", async () => {
    const err = await recordPdfSignatureFromDocument(admin, input({ version: "סודיות-0.9" })).catch((e) => e);
    expect(err).toBeInstanceOf(AgreementError);
    expect(err.message).toContain(`"${CURRENT_AGREEMENTS.CONFIDENTIALITY}"`);
    expect(db.employeeAgreement.create).not.toHaveBeenCalled();
  });

  it("accepts the Latin code from the PDF's footer in place of the Hebrew version", async () => {
    const out = await recordPdfSignatureFromDocument(admin, input({ version: "ANKORA-CONF-1.0" }));
    expect(out.alreadyRecorded).toBe(false);
    expect(db.employeeAgreement.create.mock.calls[0][0].data.version).toBe(CURRENT_AGREEMENTS.CONFIDENTIALITY);
  });

  it("refuses another kind's code, naming the expected code", async () => {
    const err = await recordPdfSignatureFromDocument(admin, input({ version: "ANKORA-DEL-1.0" })).catch((e) => e);
    expect(err).toBeInstanceOf(AgreementError);
    expect(err.message).toContain("ANKORA-CONF-1.0");
  });

  it("refuses a document that is not on the internal client", async () => {
    db.clientDocument.findFirst.mockResolvedValue({ id: "doc-1", clientId: "some-client", driveFileId: "x" });
    await expect(recordPdfSignatureFromDocument(admin, input())).rejects.toThrow(/Ankora פנימי/);
    expect(db.employeeAgreement.create).not.toHaveBeenCalled();
  });

  it("returns the existing row instead of a second one", async () => {
    db.employeeAgreement.findFirst.mockResolvedValue({ id: "old", channel: "EMAIL_PDF" });
    const out = await recordPdfSignatureFromDocument(admin, input());
    expect(out).toEqual({ row: { id: "old", channel: "EMAIL_PDF" }, alreadyRecorded: true });
    expect(db.employeeAgreement.create).not.toHaveBeenCalled();
    // The upload still leaves pendingPdfUploads: without this it would wait
    // forever once its version was already recorded.
    expect(db.agreementSignLink.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", documentId: "doc-1", purpose: "PDF_UPLOAD", reviewedAt: null },
      data: { reviewedAt: expect.any(Date), reviewedById: "admin" },
    });
    expect(onPdfSignatureRecorded).not.toHaveBeenCalled();
  });

  it("records with the document's Drive file, audits, and tells the lifecycle task", async () => {
    const out = await recordPdfSignatureFromDocument(admin, input());
    expect(out.alreadyRecorded).toBe(false);
    expect(db.employeeAgreement.create.mock.calls[0][0].data).toMatchObject({
      channel: "EMAIL_PDF",
      driveFileId: "drive-7",
      recordedById: "admin",
      version: CURRENT_AGREEMENTS.CONFIDENTIALITY,
    });
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "agreement.pdf_recorded" }));
    expect(onPdfSignatureRecorded).toHaveBeenCalledWith("u1", "CONFIDENTIALITY", "a1");
    expect(db.agreementSignLink.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", documentId: "doc-1", purpose: "PDF_UPLOAD", reviewedAt: null },
      data: { reviewedAt: expect.any(Date), reviewedById: "admin" },
    });
  });
});

describe("issueBlankAgreementTicket", () => {
  beforeEach(() => resolveInternalClient.mockResolvedValue({ id: "internal", name: "Ankora פנימי" }));

  it("is for managers and admins only, and writes nothing otherwise", async () => {
    await expect(issueBlankAgreementTicket(user(), "CONFIDENTIALITY")).rejects.toBeInstanceOf(ForbiddenError);
    expect(db.mcpFileTicket.create).not.toHaveBeenCalled();
  });

  it("issues a read_document-style address: hash stored, 15 minutes, named by the code", async () => {
    const admin = user({ id: "admin", role: "ANKORA_ADMIN", tokenVersion: 4 });
    const now = new Date("2026-10-15T08:00:00Z");
    const t = await issueBlankAgreementTicket(admin, "DELETION_DECLARATION", now);
    expect(t.url).toMatch(/\/api\/mcp\/files\/ank_fil_[A-Za-z0-9_-]+$/);
    expect(t.code).toBe("ANKORA-DEL-1.0");
    expect(t.fileName).toBe("ANKORA-DEL-1.0.pdf");
    expect(t.expiresAt.getTime() - now.getTime()).toBe(15 * 60_000);
    const data = db.mcpFileTicket.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ purpose: "agreement-blank", userId: "admin", tokenVersion: 4, clientId: "internal", fileName: "ANKORA-DEL-1.0.pdf" });
    expect(JSON.stringify(data)).not.toContain(t.url.split("/").pop()!);
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "agreement.blank_issued" }));
  });

  it("maps a ticket's file name back to its kind", () => {
    expect(kindFromBlankFileName("ANKORA-CONF-1.0.pdf")).toBe("CONFIDENTIALITY");
    expect(kindFromBlankFileName("ANKORA-DEL-1.0.pdf")).toBe("DELETION_DECLARATION");
    expect(kindFromBlankFileName("other.pdf")).toBeNull();
    expect(kindFromBlankFileName(null)).toBeNull();
  });
});
