import { beforeEach, describe, expect, it, vi } from "vitest";

// /upload's server actions: one strict per-IP budget for every check of a
// code, and one sentence for every code that is not usable.

vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-real-ip": "203.0.113.9" }) }));
const checkRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...a: unknown[]) => checkRateLimit(...a),
  clientIpFrom: (h: Headers) => h.get("x-real-ip") ?? "unknown",
}));

const domain = vi.hoisted(() => {
  class AgreementError extends Error {
    constructor(m: string) {
      super(m);
      this.name = "AgreementError";
    }
  }
  return {
    AgreementError,
    INVALID_UPLOAD_CODE_MESSAGE: "הקוד אינו תקף.",
    viewUploadCode: vi.fn(),
    uploadSignedPdfWithCode: vi.fn(),
  };
});
vi.mock("@/lib/app-domain/agreements", () => domain);

const { checkUploadCodeAction, uploadWithCodeAction } = await import("@/app/(product)/upload/actions");

function form(fields: Record<string, string | File>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}
const pdf = () => new File([new Uint8Array(Buffer.from("%PDF-1.7 x"))], "s.pdf", { type: "application/pdf" });

beforeEach(() => {
  vi.clearAllMocks();
  checkRateLimit.mockResolvedValue({ allowed: true });
});

describe("checkUploadCodeAction", () => {
  it("spends from a strict per-IP budget on every check: 10 per 15 minutes", async () => {
    domain.viewUploadCode.mockResolvedValue(null);
    await checkUploadCodeAction({}, form({ code: "K7QM-3XRB" }));
    expect(checkRateLimit).toHaveBeenCalledWith("agreement-upload-code:203.0.113.9", 10, 15 * 60 * 1000);
  });

  it("answers an unusable code with the one generic sentence", async () => {
    domain.viewUploadCode.mockResolvedValue(null);
    expect(await checkUploadCodeAction({}, form({ code: "K7QM-3XRB" }))).toEqual({ error: domain.INVALID_UPLOAD_CODE_MESSAGE });
  });

  it("stops checking codes once the budget is spent, without saying anything about the code", async () => {
    checkRateLimit.mockResolvedValue({ allowed: false });
    const out = await checkUploadCodeAction({}, form({ code: "K7QM-3XRB" }));
    expect(out.error).toContain("יותר מדי ניסיונות");
    expect(domain.viewUploadCode).not.toHaveBeenCalled();
  });

  it("moves to the file step with the title and the first name for a valid code", async () => {
    domain.viewUploadCode.mockResolvedValue({ title: "התחייבות לסודיות", firstName: "נועה", version: "v", agreementCode: "c" });
    expect(await checkUploadCodeAction({}, form({ code: "K7QM-3XRB" }))).toEqual({
      ready: { code: "K7QM-3XRB", title: "התחייבות לסודיות", firstName: "נועה" },
    });
  });
});

describe("uploadWithCodeAction", () => {
  const ready = { ready: { code: "K7QM-3XRB", title: "t", firstName: "n" } };

  it("checks the code again on submit, within the same budget", async () => {
    domain.uploadSignedPdfWithCode.mockResolvedValue({ documentId: "d", codeFound: true });
    expect(await uploadWithCodeAction(ready, form({ code: "K7QM-3XRB", file: pdf() }))).toEqual({ done: true });
    expect(domain.uploadSignedPdfWithCode.mock.calls[0][0]).toBe("K7QM-3XRB");
    expect(checkRateLimit).toHaveBeenCalledWith("agreement-upload-code:203.0.113.9", 10, 15 * 60 * 1000);
  });

  it("sends a code that stopped being valid back to the code step, with the generic sentence", async () => {
    domain.uploadSignedPdfWithCode.mockRejectedValue(new domain.AgreementError(domain.INVALID_UPLOAD_CODE_MESSAGE));
    expect(await uploadWithCodeAction(ready, form({ code: "K7QM-3XRB", file: pdf() }))).toEqual({ error: domain.INVALID_UPLOAD_CODE_MESSAGE });
  });

  it("keeps the file step for a file problem, with its own message", async () => {
    domain.uploadSignedPdfWithCode.mockRejectedValue(new domain.AgreementError("הקובץ אינו PDF."));
    expect(await uploadWithCodeAction(ready, form({ code: "K7QM-3XRB", file: pdf() }))).toEqual({ ...ready, error: "הקובץ אינו PDF." });
  });
});
