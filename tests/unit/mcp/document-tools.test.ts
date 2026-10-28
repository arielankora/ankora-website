import { beforeEach, describe, expect, it, vi } from "vitest";

// MCP document files (12.10.2026): list_documents, read_document,
// upload_document and start_document_upload.
//
// Same approach as task-extra-tools.test.ts: the domain layer is mocked and
// what is under test is the tool surface's own decisions. The ones that
// matter:
//
//   1. A document Claude files is hidden from the client unless the model
//      said otherwise (the screen's default is the opposite, on purpose).
//   2. A refused call files nothing: bad base64 is refused before any
//      lookup, and a missing destination before any write.
//   3. A task decides its own client, so a document cannot be filed on a
//      task under some other client.
//   4. Reading returns text (or an image), never base64 of a PDF, and
//      always an address for the original.

const files = vi.hoisted(() => ({
  MAX_INLINE_IMAGE_BYTES: 3 * 1024 * 1024,
  MAX_DOCUMENT_BYTES: 4 * 1024 * 1024,
  fileDocumentFromMcp: vi.fn(),
  issueUploadTicket: vi.fn(),
  issueDownloadTicket: vi.fn(),
  listDocumentsForMcp: vi.fn(),
  findDocumentForMcp: vi.fn(),
  readDocumentForMcp: vi.fn(),
}));

const lookup = vi.hoisted(() => ({
  lookupClient: vi.fn(),
  lookupCategory: vi.fn(),
  autoPickCategory: vi.fn(async (): Promise<unknown> => null),
  taskCategoryInfo: vi.fn(async (): Promise<unknown> => null),
  usableCategoryById: vi.fn(async (): Promise<unknown> => null),
  lookupTeamMember: vi.fn(),
  lookupAssignee: vi.fn(),
  lookupTask: vi.fn(),
  lookupTaskById: vi.fn(),
  usableCategories: vi.fn(),
  teamMembers: vi.fn(),
  canSeeOthersTime: vi.fn(() => false),
}));

const auth = vi.hoisted(() => ({ actorFromAuthInfo: vi.fn() }));

// 20.10.2026: set_document_kind writes through the client-documents domain.
const documents = vi.hoisted(() => ({ setClientDocumentKind: vi.fn() }));

// 28.10.2026: "בלי AI" lookups need a database; nothing here is marked.
vi.mock("@/lib/app-domain/ai-exclusion-db", () => ({ aiExcludedTaskIds: vi.fn(async () => new Set()), aiExcludedClientIds: vi.fn(async () => new Set()), isTaskAiExcluded: vi.fn(async () => false), isDocumentAiExcluded: vi.fn(async () => false) }));
vi.mock("@/lib/app-domain/mcp-files", () => files);
vi.mock("@/lib/app-domain/client-documents", () => documents);
vi.mock("@/lib/app-domain/time-entries", () => ({}));
vi.mock("@/lib/app-domain/tasks", () => ({ OPEN_STATUSES: [] }));
vi.mock("@/lib/app-domain/decisions", () => ({}));
vi.mock("@/lib/app-domain/task-plans", () => ({ PlanVersionConflictError: class extends Error {} }));
vi.mock("@/lib/mcp/lookup", () => lookup);
vi.mock("@/lib/mcp/auth", () => auth);
vi.mock("@/lib/app-domain/clients", () => ({ listAccessibleClients: vi.fn(async () => []) }));
vi.mock("@/lib/app-auth/permissions", () => ({ assertCan: vi.fn() }));
vi.mock("@/lib/email-templates", () => ({ appBaseUrl: () => "https://www.ankora.co.il" }));

import { registerAnkoraTools } from "@/lib/mcp/tools";
import { TOOL_ANNOTATIONS } from "@/lib/mcp/annotations";

type Block = { type: string; text?: string; data?: string; mimeType?: string };
type Handler = (args: unknown, ctx: unknown) => Promise<{ content: Block[]; isError?: boolean }>;

function collectTools() {
  const tools = new Map<string, { config: Record<string, unknown>; handler: Handler }>();
  registerAnkoraTools({
    registerTool: (name: string, config: Record<string, unknown>, handler: Handler) => {
      tools.set(name, { config, handler });
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  return tools;
}

const ACTOR = { id: "u-hadas", name: "הדס", role: "ANKORA_EMPLOYEE", timezone: "Asia/Jerusalem", tokenVersion: 0 };
const CTX = { http: { authInfo: { token: "verified" } } };

const DOC = {
  id: "doc-1",
  title: "טופס 101 חתום",
  kind: "OTHER",
  mimeType: "application/pdf",
  sizeBytes: 320 * 1024,
  clientVisible: false,
  clientId: "c-nux",
  driveFileId: "drive-1",
  taskId: "t1",
  createdAt: new Date("2026-10-05T08:00:00Z"),
  task: { id: "t1", title: "החתמת עובדים" },
  uploadedBy: { name: "הדס" },
  client: { name: "NUX" },
};

let tools: ReturnType<typeof collectTools>;
const raw = (name: string, args: unknown) => tools.get(name)!.handler(args, CTX);
const json = async (name: string, args: unknown) => {
  const r = await raw(name, args);
  try {
    return JSON.parse(r.content[0].text!);
  } catch {
    return { text: r.content[0].text };
  }
};

beforeEach(() => {
  vi.clearAllMocks();
  auth.actorFromAuthInfo.mockReturnValue(ACTOR);
  lookup.lookupClient.mockResolvedValue({ ok: true, value: { id: "c-nux", name: "NUX" } });
  lookup.lookupTaskById.mockResolvedValue({ ok: true, value: { id: "t1", name: "החתמת עובדים", clientId: "c-nux", clientName: "NUX" } });
  lookup.lookupTask.mockResolvedValue({ ok: true, value: { id: "t1", name: "החתמת עובדים", clientId: "c-nux", clientName: "NUX" } });
  files.fileDocumentFromMcp.mockImplementation(async (_a: unknown, input: { title: string; clientVisible: boolean }) => ({
    id: "doc-new",
    title: input.title,
    clientVisible: input.clientVisible,
  }));
  files.issueUploadTicket.mockResolvedValue({ ticket: "ank_fil_UP", expiresAt: new Date("2026-10-12T08:15:00Z") });
  files.issueDownloadTicket.mockResolvedValue({ ticket: "ank_fil_DOWN", expiresAt: new Date("2026-10-12T08:15:00Z") });
  files.findDocumentForMcp.mockResolvedValue(DOC);
  files.listDocumentsForMcp.mockResolvedValue([DOC]);
  tools = collectTools();
});

describe("registration", () => {
  it("registers the four tools, reads as reads and writes as writes", () => {
    for (const name of ["list_documents", "read_document", "upload_document", "start_document_upload"]) {
      expect(tools.has(name), name).toBe(true);
    }
    expect(TOOL_ANNOTATIONS.list_documents.readOnlyHint).toBe(true);
    expect(TOOL_ANNOTATIONS.read_document.readOnlyHint).toBe(true);
    expect(TOOL_ANNOTATIONS.upload_document.readOnlyHint).toBe(false);
    expect(TOOL_ANNOTATIONS.start_document_upload.readOnlyHint).toBe(false);
  });
});

describe("upload_document", () => {
  const pdf = Buffer.from("%PDF-1.4 test").toString("base64");

  it("files on the task's own client, hidden from the client by default", async () => {
    const out = await json("upload_document", { taskId: "t1", title: "טופס 101 חתום", fileName: "101.pdf", contentBase64: pdf });
    expect(out).toMatchObject({ filed: true, documentId: "doc-new", client: "NUX", task: "החתמת עובדים", clientVisible: false });
    const [, input, content] = files.fileDocumentFromMcp.mock.calls[0];
    expect(input).toMatchObject({ clientId: "c-nux", taskId: "t1", clientVisible: false, kind: "OTHER" });
    expect((content as Buffer).toString()).toBe("%PDF-1.4 test");
  });

  it("shows it to the client only when asked to", async () => {
    await json("upload_document", { client: "NUX", title: "x", fileName: "x.pdf", contentBase64: pdf, clientVisible: true });
    expect(files.fileDocumentFromMcp.mock.calls[0][1]).toMatchObject({ clientVisible: true, taskId: null });
  });

  it("refuses broken base64 before anything else, and files nothing", async () => {
    const out = await json("upload_document", { client: "NUX", title: "x", fileName: "x.pdf", contentBase64: "%%%not base64" });
    expect(out.text).toContain("not valid base64");
    expect(files.fileDocumentFromMcp).not.toHaveBeenCalled();
    expect(lookup.lookupClient).not.toHaveBeenCalled();
  });

  it("asks where it goes when neither task nor client is given", async () => {
    const out = await json("upload_document", { title: "x", fileName: "x.pdf", contentBase64: pdf });
    expect(out.text).toContain("Say where the document goes");
    expect(files.fileDocumentFromMcp).not.toHaveBeenCalled();
  });

  it("passes a lookup failure through in words, and files nothing", async () => {
    lookup.lookupClient.mockResolvedValue({ ok: false, message: 'No client matches "נוקס". Did you mean NUX?' });
    const out = await json("upload_document", { client: "נוקס", title: "x", fileName: "x.pdf", contentBase64: pdf });
    expect(out.text).toContain("Did you mean NUX");
    expect(files.fileDocumentFromMcp).not.toHaveBeenCalled();
  });
});

describe("start_document_upload", () => {
  it("returns an address on the app's host and a curl line, and stores no bytes", async () => {
    const out = await json("start_document_upload", { taskId: "t1", title: "חוזה", kind: "CONTRACT", fileName: "contract.pdf" });
    expect(out.uploadUrl).toBe("https://www.ankora.co.il/api/mcp/files/ank_fil_UP");
    expect(out.example).toBe('curl -sS -T "contract.pdf" "https://www.ankora.co.il/api/mcp/files/ank_fil_UP"');
    expect(out.clientVisible).toBe(false);
    expect(files.issueUploadTicket.mock.calls[0][1]).toMatchObject({ clientId: "c-nux", taskId: "t1", kind: "CONTRACT", clientVisible: false });
    expect(files.fileDocumentFromMcp).not.toHaveBeenCalled();
  });
});

describe("list_documents", () => {
  it("lists a task's documents with the id read_document takes", async () => {
    const out = await json("list_documents", { taskId: "t1" });
    expect(files.listDocumentsForMcp.mock.calls[0][1]).toEqual({ clientId: "c-nux", taskId: "t1" });
    expect(out.documents[0]).toMatchObject({ documentId: "doc-1", title: "טופס 101 חתום", sizeKB: 320, uploadedOn: "2026-10-05" });
    expect(out.documents[0]).not.toHaveProperty("driveFileId");
  });

  it("with nothing named, lists across the user's clients", async () => {
    await json("list_documents", {});
    expect(files.listDocumentsForMcp.mock.calls[0][1]).toEqual({ clientId: undefined, taskId: undefined });
  });
});

describe("read_document", () => {
  it("returns the text and a download address, never the PDF's bytes", async () => {
    files.readDocumentForMcp.mockResolvedValue({
      ok: true,
      extracted: { kind: "text", text: "[עמוד 1]\nשם העובד: דנה", truncated: false, pages: 1 },
      bytes: Buffer.alloc(1000),
    });
    const r = await raw("read_document", { documentId: "doc-1" });
    expect(r.content).toHaveLength(2);
    const meta = JSON.parse(r.content[0].text!);
    expect(meta).toMatchObject({ documentId: "doc-1", downloadUrl: "https://www.ankora.co.il/api/mcp/files/ank_fil_DOWN", pages: 1 });
    expect(meta).not.toHaveProperty("driveFileId");
    expect(r.content[1]).toEqual({ type: "text", text: "[עמוד 1]\nשם העובד: דנה" });
    expect(r.content.some((b) => b.type === "image")).toBe(false);
  });

  it("returns a photo as an image block", async () => {
    files.findDocumentForMcp.mockResolvedValue({ ...DOC, mimeType: "image/jpeg" });
    files.readDocumentForMcp.mockResolvedValue({ ok: true, extracted: { kind: "image" }, bytes: Buffer.from([1, 2, 3]) });
    const r = await raw("read_document", { documentId: "doc-1" });
    expect(r.content[1]).toEqual({ type: "image", data: Buffer.from([1, 2, 3]).toString("base64"), mimeType: "image/jpeg" });
  });

  it("explains a scan and points at the download instead of returning nothing", async () => {
    files.readDocumentForMcp.mockResolvedValue({
      ok: true,
      extracted: { kind: "none", reason: "This PDF has no text layer (it is probably a scan)." },
      bytes: Buffer.alloc(10),
    });
    const r = await raw("read_document", { documentId: "doc-1" });
    expect(r.content).toHaveLength(1);
    expect(JSON.parse(r.content[0].text!).content).toContain("downloadUrl");
  });

  it("does not say whether an unknown id exists", async () => {
    files.findDocumentForMcp.mockResolvedValue(null);
    const out = await json("read_document", { documentId: "doc-other-client" });
    expect(out.text).toContain("that you can see");
    expect(files.readDocumentForMcp).not.toHaveBeenCalled();
    expect(files.issueDownloadTicket).not.toHaveBeenCalled();
  });

  it("finds a document by title on a task, and asks when two match", async () => {
    files.readDocumentForMcp.mockResolvedValue({ ok: true, extracted: { kind: "text", text: "x", truncated: false }, bytes: Buffer.alloc(1) });
    await raw("read_document", { title: "טופס 101 חתום", taskId: "t1" });
    expect(files.readDocumentForMcp.mock.calls[0][1]).toMatchObject({ id: "doc-1" });

    files.listDocumentsForMcp.mockResolvedValue([DOC, { ...DOC, id: "doc-2" }]);
    const out = await json("read_document", { title: "טופס 101 חתום", taskId: "t1" });
    expect(out.text).toContain("documentId doc-2");
  });
});

describe("set_document_kind (20.10.2026)", () => {
  it("is a write that can be repeated safely", () => {
    expect(TOOL_ANNOTATIONS.set_document_kind.readOnlyHint).toBe(false);
    expect(TOOL_ANNOTATIONS.set_document_kind.idempotentHint).toBe(true);
  });

  it("changes the kind of a document this person can see, and says what it was", async () => {
    const out = await json("set_document_kind", { documentId: "doc-1", kind: "PROCEDURE" });
    expect(files.findDocumentForMcp).toHaveBeenCalledWith(ACTOR, "doc-1");
    expect(documents.setClientDocumentKind).toHaveBeenCalledWith(ACTOR, "doc-1", "PROCEDURE");
    expect(out.kindLabel).toBe("נוהל");
    expect(out.previousKind).toBe(DOC.kind);
  });

  it("changes nothing for a document it cannot find", async () => {
    files.findDocumentForMcp.mockResolvedValueOnce(null);
    const out = await json("set_document_kind", { documentId: "nope", kind: "PROCEDURE" });
    expect(out.text).toContain("No document");
    expect(documents.setClientDocumentKind).not.toHaveBeenCalled();
  });
});
