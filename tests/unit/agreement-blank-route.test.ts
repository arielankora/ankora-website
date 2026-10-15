import { beforeEach, describe, expect, it, vi } from "vitest";

// GET /app/agreements/blank/[kind]: the blank form as a download, for
// managers and admins only.

const session = vi.hoisted(() => {
  class UnauthorizedError extends Error {
    constructor() {
      super("Unauthorized");
      this.name = "UnauthorizedError";
    }
  }
  return { UnauthorizedError, requireUserOrThrow: vi.fn() };
});
const domain = vi.hoisted(() => ({
  blankAgreementPdf: vi.fn(async () => ({ pdf: Buffer.from("%PDF-1.7 blank"), code: "ANKORA-CONF-1.0", fileName: "ANKORA-CONF-1.0.pdf" })),
}));
vi.mock("@/lib/app-auth/session", () => session);
vi.mock("@/lib/app-domain/agreements", () => domain);
vi.mock("@/lib/app-auth/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { GET } = await import("@/app/(product)/app/agreements/blank/[kind]/route");
const call = (kind: string) => GET(new Request("http://x/app/agreements/blank/" + kind), { params: Promise.resolve({ kind }) });

beforeEach(() => vi.clearAllMocks());

describe("GET /app/agreements/blank/[kind]", () => {
  it("refuses without a session, and refuses an employee", async () => {
    session.requireUserOrThrow.mockRejectedValueOnce(new session.UnauthorizedError());
    expect((await call("confidentiality")).status).toBe(401);
    session.requireUserOrThrow.mockResolvedValueOnce({ id: "e", role: "ANKORA_EMPLOYEE" });
    expect((await call("confidentiality")).status).toBe(403);
    expect(domain.blankAgreementPdf).not.toHaveBeenCalled();
  });

  it("returns the form as an attachment named by its code", async () => {
    session.requireUserOrThrow.mockResolvedValue({ id: "a", role: "ANKORA_ADMIN" });
    const res = await call("confidentiality");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    expect(res.headers.get("content-disposition")).toContain("ANKORA-CONF-1.0.pdf");
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 4).toString()).toBe("%PDF");
    expect(domain.blankAgreementPdf).toHaveBeenCalledWith("CONFIDENTIALITY");
  });

  it("answers 404 for a kind that does not exist", async () => {
    session.requireUserOrThrow.mockResolvedValue({ id: "a", role: "SUPER_ADMIN" });
    expect((await call("nda")).status).toBe(404);
  });
});
