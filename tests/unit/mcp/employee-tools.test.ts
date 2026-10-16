import { beforeEach, describe, expect, it, vi } from "vitest";

// get_employee_status and record_pdf_signature (lib/mcp/employee-tools.ts),
// the employee lifecycle agents' view of Ankora. The domain functions are
// mocked; what is under test is the gate (before any read), how a person
// is resolved, how signedAt is read, and what reaches the model.

const status = vi.hoisted(() => {
  class EmployeeNotFoundError extends Error {
    constructor() {
      super("No Ankora staff member with that id.");
      this.name = "EmployeeNotFoundError";
    }
  }
  return { EmployeeNotFoundError, getEmployeeStatus: vi.fn() };
});
const agreements = vi.hoisted(() => {
  class AgreementError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "AgreementError";
    }
  }
  return {
    AgreementError,
    recordPdfSignatureFromDocument: vi.fn(),
    issueBlankAgreementTicket: vi.fn(),
    issueAgreementUploadCode: vi.fn(),
    dismissPdfUpload: vi.fn(),
  };
});
const lookup = vi.hoisted(() => ({ lookupStaffMember: vi.fn(), lookupClient: vi.fn() }));
const auth = vi.hoisted(() => ({ actorFromAuthInfo: vi.fn() }));
const permissions = vi.hoisted(() => {
  class ForbiddenError extends Error {
    constructor(message = "Forbidden") {
      super(message);
      this.name = "ForbiddenError";
    }
  }
  const ALLOWED = new Set(["SUPER_ADMIN", "ANKORA_ADMIN"]);
  return {
    ForbiddenError,
    assertCan: vi.fn((role: string, permission: string) => {
      if (permission === "time_entry.edit_others" && !ALLOWED.has(role)) throw new ForbiddenError(`${role} may not ${permission}`);
    }),
    can: vi.fn(() => false),
    canManageClients: vi.fn(() => false),
  };
});

vi.mock("@/lib/app-domain/employee-status", () => status);
vi.mock("@/lib/app-domain/agreements", () => agreements);
vi.mock("@/lib/mcp/lookup", () => lookup);
vi.mock("@/lib/mcp/auth", () => auth);
vi.mock("@/lib/app-auth/permissions", () => permissions);
// Nothing here may reach a database; task-extra-tools (for actorOf) pulls
// in domain modules that would otherwise open Prisma at import.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/app-domain/decisions", () => ({ createDecision: vi.fn(), listDecisionsForClient: vi.fn() }));

import { parseIsraelDateTime, registerEmployeeTools } from "@/lib/mcp/employee-tools";
import { TOOL_ANNOTATIONS } from "@/lib/mcp/annotations";

type Handler = (args: unknown, ctx: unknown) => Promise<{ content: { type: string; text: string }[]; isError?: boolean }>;

function collectTools() {
  const tools = new Map<string, { config: Record<string, unknown>; handler: Handler }>();
  registerEmployeeTools({
    registerTool: (name: string, config: Record<string, unknown>, handler: Handler) => {
      tools.set(name, { config, handler });
    },
  } as any);
  return tools;
}

const EMPLOYEE = { id: "u-emp", name: "נועה", role: "ANKORA_EMPLOYEE", timezone: "Asia/Jerusalem" };
const ADMIN = { id: "u-adm", name: "Ariel", role: "SUPER_ADMIN", timezone: "Asia/Jerusalem" };
const CTX = { http: { authInfo: { token: "verified" } } };

const text = (r: { content: { text: string }[] }) => r.content.map((c) => c.text).join("");
const json = (r: { content: { text: string }[] }) => JSON.parse(text(r));

const PDF_ARGS = {
  userId: "u-new",
  kind: "CONFIDENTIALITY",
  version: "סודיות-1.0",
  signedName: "דנה כהן",
  signedAt: "2026-10-15",
  documentId: "doc-1",
};

let tools: ReturnType<typeof collectTools>;
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  auth.actorFromAuthInfo.mockReturnValue(ADMIN);
  tools = collectTools();
});

describe("registration", () => {
  it("registers both tools with the annotations table's entries", () => {
    expect(tools.get("get_employee_status")!.config.annotations).toBe(TOOL_ANNOTATIONS.get_employee_status);
    expect(tools.get("record_pdf_signature")!.config.annotations).toBe(TOOL_ANNOTATIONS.record_pdf_signature);
    expect(TOOL_ANNOTATIONS.get_employee_status.readOnlyHint).toBe(true);
    expect(TOOL_ANNOTATIONS.record_pdf_signature.readOnlyHint).toBe(false);
  });

  it("tells the agent to check version and signature, and to stop when unsure", () => {
    const d = String(tools.get("record_pdf_signature")!.config.description);
    expect(d).toContain("version");
    expect(d).toContain("ANKORA-CONF-1.0");
    expect(d).toContain("read_document");
    expect(d).toContain("signature is visibly there");
    expect(d).toContain("do not record");
    expect(d).toContain("Ankora פנימי");
  });
});

describe("the manager/admin gate", () => {
  it("refuses an employee on both tools before reading or writing anything", async () => {
    auth.actorFromAuthInfo.mockReturnValue(EMPLOYEE);
    const a = await tools.get("get_employee_status")!.handler({ person: "דנה" }, CTX);
    const b = await tools.get("record_pdf_signature")!.handler(PDF_ARGS, CTX);
    expect(a.isError).toBe(true);
    expect(b.isError).toBe(true);
    expect(lookup.lookupStaffMember).not.toHaveBeenCalled();
    expect(status.getEmployeeStatus).not.toHaveBeenCalled();
    expect(agreements.recordPdfSignatureFromDocument).not.toHaveBeenCalled();
    const c = await tools.get("get_blank_agreement_pdf")!.handler({ kind: "CONFIDENTIALITY" }, CTX);
    expect(c.isError).toBe(true);
    expect(agreements.issueBlankAgreementTicket).not.toHaveBeenCalled();
  });
});

describe("issue_agreement_upload_code", () => {
  it("refuses an employee and issues nothing", async () => {
    auth.actorFromAuthInfo.mockReturnValue(EMPLOYEE);
    const r = await tools.get("issue_agreement_upload_code")!.handler({ userId: "u-new", kind: "CONFIDENTIALITY" }, CTX);
    expect(r.isError).toBe(true);
    expect(agreements.issueAgreementUploadCode).not.toHaveBeenCalled();
  });

  it("returns the code, the fixed page, expiry, version and agreementCode", async () => {
    agreements.issueAgreementUploadCode.mockResolvedValue({
      uploadCode: "K7QM-3XRB",
      uploadPageUrl: "https://www.ankora.co.il/upload",
      expiresAt: new Date("2026-10-23T08:00:00Z"),
      version: "סודיות-1.0",
      agreementCode: "ANKORA-CONF-1.0",
    });
    const out = json(await tools.get("issue_agreement_upload_code")!.handler({ userId: "u-new", kind: "CONFIDENTIALITY" }, CTX));
    expect(agreements.issueAgreementUploadCode).toHaveBeenCalledWith(ADMIN, "u-new", "CONFIDENTIALITY");
    expect(out).toEqual({
      kind: "CONFIDENTIALITY",
      uploadCode: "K7QM-3XRB",
      uploadPageUrl: "https://www.ankora.co.il/upload",
      expiresAt: "2026-10-23T08:00:00.000Z",
      version: "סודיות-1.0",
      agreementCode: "ANKORA-CONF-1.0",
    });
  });

  it("tells the agent: plain text, that employee only, the code is not a link", () => {
    const d = String(tools.get("issue_agreement_upload_code")!.config.description);
    expect(d).toContain("plain text in the email to that employee only");
    expect(d).toContain("The code must not be a link");
    expect(d).toContain("ומקלידים את הקוד");
    expect(tools.has("issue_agreement_upload_link")).toBe(false);
    expect(TOOL_ANNOTATIONS.issue_agreement_upload_code.readOnlyHint).toBe(false);
  });
});

describe("dismiss_pdf_upload", () => {
  it("refuses an employee and changes nothing", async () => {
    auth.actorFromAuthInfo.mockReturnValue(EMPLOYEE);
    const r = await tools.get("dismiss_pdf_upload")!.handler({ documentId: "doc-1", reason: "x" }, CTX);
    expect(r.isError).toBe(true);
    expect(agreements.dismissPdfUpload).not.toHaveBeenCalled();
  });

  it("dismisses with the reason, and passes the domain's refusal through", async () => {
    agreements.dismissPdfUpload.mockResolvedValueOnce({ documentId: "doc-1", kind: "CONFIDENTIALITY", userId: "u-new" });
    const out = json(await tools.get("dismiss_pdf_upload")!.handler({ documentId: "doc-1", reason: "אין חתימה" }, CTX));
    expect(agreements.dismissPdfUpload).toHaveBeenCalledWith(ADMIN, "doc-1", "אין חתימה");
    expect(out).toEqual({ dismissed: true, documentId: "doc-1", kind: "CONFIDENTIALITY" });

    agreements.dismissPdfUpload.mockRejectedValueOnce(new agreements.AgreementError("This upload was already reviewed. Nothing was changed."));
    const r = await tools.get("dismiss_pdf_upload")!.handler({ documentId: "doc-1", reason: "x" }, CTX);
    expect(text(r)).toContain("already reviewed");
  });
});

describe("get_blank_agreement_pdf", () => {
  it("hands back the download address, the code and the file name", async () => {
    agreements.issueBlankAgreementTicket.mockResolvedValue({
      url: "https://www.ankora.co.il/api/mcp/files/ank_fil_abc",
      expiresAt: new Date("2026-10-15T08:15:00Z"),
      code: "ANKORA-CONF-1.0",
      version: "סודיות-1.0",
      fileName: "ANKORA-CONF-1.0.pdf",
    });
    const out = json(await tools.get("get_blank_agreement_pdf")!.handler({ kind: "CONFIDENTIALITY" }, CTX));
    expect(agreements.issueBlankAgreementTicket).toHaveBeenCalledWith(ADMIN, "CONFIDENTIALITY");
    expect(out).toEqual({
      kind: "CONFIDENTIALITY",
      version: "סודיות-1.0",
      code: "ANKORA-CONF-1.0",
      fileName: "ANKORA-CONF-1.0.pdf",
      downloadUrl: "https://www.ankora.co.il/api/mcp/files/ank_fil_abc",
      expiresAt: "2026-10-15T08:15:00.000Z",
    });
  });

  it("tells the agent to attach the file and that the footer code is the check", () => {
    const d = String(tools.get("get_blank_agreement_pdf")!.config.description);
    expect(d).toContain("attach");
    expect(d).toContain("code");
    expect(d).toContain("curl");
  });
});

describe("get_employee_status", () => {
  it("resolves a person by name among staff of any status", async () => {
    lookup.lookupStaffMember.mockResolvedValue({ ok: true, value: { id: "u-new", name: "דנה", email: "d@a" } });
    status.getEmployeeStatus.mockResolvedValue({ id: "u-new", personalEmailOnFile: true });
    const out = json(await tools.get("get_employee_status")!.handler({ person: "דנה" }, CTX));
    expect(status.getEmployeeStatus).toHaveBeenCalledWith(ADMIN, "u-new");
    expect(out).toEqual({ id: "u-new", personalEmailOnFile: true });
  });

  it("takes an id as given, and says so plainly when it is nobody", async () => {
    status.getEmployeeStatus.mockRejectedValue(new status.EmployeeNotFoundError());
    const r = await tools.get("get_employee_status")!.handler({ userId: "nope" }, CTX);
    expect(lookup.lookupStaffMember).not.toHaveBeenCalled();
    expect(text(r)).toContain("No Ankora staff member");
  });

  it("asks who when neither person nor userId is given", async () => {
    const r = await tools.get("get_employee_status")!.handler({}, CTX);
    expect(text(r)).toContain("person");
    expect(status.getEmployeeStatus).not.toHaveBeenCalled();
  });
});

describe("record_pdf_signature", () => {
  it("reads signedAt as Israel time and returns the signature without file ids", async () => {
    agreements.recordPdfSignatureFromDocument.mockResolvedValue({
      alreadyRecorded: false,
      row: {
        id: "a1",
        kind: "CONFIDENTIALITY",
        version: "סודיות-1.0",
        channel: "EMAIL_PDF",
        signedName: "דנה כהן",
        signedAt: new Date("2026-10-14T21:00:00Z"),
        driveFileId: "drive-secret-id",
        ip: null,
        userAgent: null,
        contentHash: "abc",
      },
    });
    const out = json(await tools.get("record_pdf_signature")!.handler(PDF_ARGS, CTX));
    const call = agreements.recordPdfSignatureFromDocument.mock.calls[0][1];
    expect(call.signedAt.toISOString()).toBe("2026-10-14T21:00:00.000Z");
    expect(call).toMatchObject({ userId: "u-new", kind: "CONFIDENTIALITY", version: "סודיות-1.0", documentId: "doc-1" });
    expect(out.alreadyRecorded).toBe(false);
    expect(out.signature).toMatchObject({ id: "a1", channel: "EMAIL_PDF", filed: true });
    expect(JSON.stringify(out)).not.toContain("drive-secret-id");
    expect(JSON.stringify(out)).not.toContain("contentHash");
  });

  it("passes alreadyRecorded through", async () => {
    agreements.recordPdfSignatureFromDocument.mockResolvedValue({
      alreadyRecorded: true,
      row: { id: "old", kind: "CONFIDENTIALITY", version: "סודיות-1.0", channel: "EMAIL_PDF", signedName: "x", signedAt: new Date(), driveFileId: null },
    });
    const out = json(await tools.get("record_pdf_signature")!.handler(PDF_ARGS, CTX));
    expect(out.alreadyRecorded).toBe(true);
    expect(out.signature.id).toBe("old");
  });

  it("returns the domain's refusal, such as a version mismatch, and says nothing was recorded", async () => {
    agreements.recordPdfSignatureFromDocument.mockRejectedValue(
      new agreements.AgreementError('The current version of CONFIDENTIALITY is "סודיות-1.0", not "סודיות-0.9".')
    );
    const r = await tools.get("record_pdf_signature")!.handler({ ...PDF_ARGS, version: "סודיות-0.9" }, CTX);
    expect(text(r)).toContain('"סודיות-1.0"');
    expect(text(r)).toContain("Nothing was recorded.");
  });

  it("refuses a signedAt it cannot read, before writing", async () => {
    const r = await tools.get("record_pdf_signature")!.handler({ ...PDF_ARGS, signedAt: "yesterday" }, CTX);
    expect(text(r)).toContain("signedAt");
    expect(agreements.recordPdfSignatureFromDocument).not.toHaveBeenCalled();
  });
});

describe("parseIsraelDateTime", () => {
  it("reads dates and wall-clock times as Israel time, and offsets as given", () => {
    expect(parseIsraelDateTime("2026-10-15")!.toISOString()).toBe("2026-10-14T21:00:00.000Z");
    expect(parseIsraelDateTime("2026-10-15 14:30")!.toISOString()).toBe("2026-10-15T11:30:00.000Z");
    expect(parseIsraelDateTime("2026-12-15T14:30")!.toISOString()).toBe("2026-12-15T12:30:00.000Z");
    expect(parseIsraelDateTime("2026-10-15T14:30:00Z")!.toISOString()).toBe("2026-10-15T14:30:00.000Z");
    expect(parseIsraelDateTime("15/10/2026")).toBeNull();
  });
});
