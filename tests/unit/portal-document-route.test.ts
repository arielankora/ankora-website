import { beforeEach, describe, expect, it, vi } from "vitest";

// The portal download, the only way a document reaches a client. Its
// filename used to be the document's title as typed ("DPA של Unipile,
// ממולא לחתימה"), with no extension, so a PDF saved on a Mac showed as
// "Document" and did not open (9.11.2026). These tests pin the name, and
// that a refused document stays a plain 404.

const h = vi.hoisted(() => ({
  doc: { driveFileId: "drive-1", title: "DPA של Unipile, ממולא לחתימה (עוד לא חתום)", mimeType: "application/pdf" },
  refuse: false,
}));

vi.mock("@/lib/app-auth/session", () => ({ requireUser: async () => ({ id: "u1", role: "CLIENT" }) }));
vi.mock("@/lib/app-domain/client-file", async () => {
  const { ForbiddenError } = await import("@/lib/app-auth/permissions");
  return {
    resolvePortalDocument: async () => {
      if (h.refuse) throw new ForbiddenError("no");
      return h.doc;
    },
  };
});
vi.mock("@/lib/google-drive", () => ({
  downloadFileFromDrive: async () => ({ ok: true, body: new Uint8Array([37, 80, 68, 70]).buffer }),
}));

import { GET } from "@/app/api/portal/documents/[documentId]/route";

const call = () => GET(new Request("https://www.ankora.co.il/api/portal/documents/d1"), { params: Promise.resolve({ documentId: "d1" }) });

describe("/api/portal/documents/[documentId]", () => {
  beforeEach(() => {
    h.refuse = false;
    h.doc = { driveFileId: "drive-1", title: "DPA של Unipile, ממולא לחתימה (עוד לא חתום)", mimeType: "application/pdf" };
  });

  it("saves a PDF whose title has no extension with .pdf", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    const disposition = res.headers.get("Content-Disposition") ?? "";
    expect(disposition).toMatch(/filename="[^"]*\.pdf"/);
    expect(decodeURIComponent(disposition.split("filename*=UTF-8''")[1] ?? "")).toBe(
      "DPA של Unipile, ממולא לחתימה (עוד לא חתום).pdf"
    );
  });

  it("does not add a second extension when the title already has one", async () => {
    h.doc = { ...h.doc, title: "טופס 101.PDF" };
    const disposition = (await call()).headers.get("Content-Disposition") ?? "";
    expect(decodeURIComponent(disposition.split("filename*=UTF-8''")[1] ?? "")).toBe("טופס 101.PDF");
  });

  it("answers 404 for a document the person may not have", async () => {
    h.refuse = true;
    const res = await call();
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Disposition")).toBeNull();
  });
});
