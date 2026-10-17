import { beforeEach, describe, expect, it, vi } from "vitest";

// Onboarding step 5 (the signed PDF, checked and filed) closes once the
// current confidentiality version is signed in both channels, whichever
// arrives second. Before this fix it closed only when the PDF was recorded
// after the in-app signature; a PDF recorded first left it open for good.

const signed = { APP: false, EMAIL_PDF: false };
const db = {
  employeeAgreement: {
    findFirst: vi.fn(async (args: { where: { channel: "APP" | "EMAIL_PDF" } }) => (signed[args.where.channel] ? { id: "sig" } : null)),
  },
  task: { findFirst: vi.fn() },
  taskComment: { create: vi.fn(async (_args: { data: { body: string } }) => ({ id: "c" })) },
  passkey: { count: vi.fn(async () => 0) },
};
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/app-auth/audit", () => ({ recordAudit: vi.fn() }));

const completeStepAsSystem = vi.fn();
vi.mock("@/lib/app-domain/tasks", () => ({
  OPEN_STATUSES: ["OPEN", "IN_PROGRESS", "PENDING_APPROVAL"],
  createTask: vi.fn(),
  updateTask: vi.fn(),
  assignableUsers: vi.fn(),
  completeStepAsSystem: (...a: unknown[]) => completeStepAsSystem(...a),
}));
vi.mock("@/lib/app-domain/mcp-connections", () => ({ revokeClaudeGrantsForUser: vi.fn() }));

const lifecycle = await import("@/lib/app-domain/employee-lifecycle");
const { ONBOARDING_STEPS } = await import("@/lib/employee-lifecycle-prompts");

const PDF_STEP = ONBOARDING_STEPS[4];
const SIGN_STEP = ONBOARDING_STEPS[3];

/// The onboarding task with its open steps, as the database would answer.
let openSteps: Set<string>;
function wireTask() {
  db.task.findFirst.mockImplementation(async (args: { where: { parentId?: string; title?: string; subjectUserId?: string } }) => {
    if (args.where.subjectUserId) return { id: "onb", clientId: "internal" };
    if (args.where.title && openSteps.has(args.where.title)) return { id: args.where.title === PDF_STEP ? "step5" : "step4" };
    return null;
  });
  completeStepAsSystem.mockImplementation(async (id: string) => {
    const title = id === "step5" ? PDF_STEP : SIGN_STEP;
    if (!openSteps.has(title)) return false;
    openSteps.delete(title);
    return true;
  });
}

const closedPdfStep = () => completeStepAsSystem.mock.calls.filter((c) => c[0] === "step5").length;
const bothChannelsNotes = () =>
  db.taskComment.create.mock.calls.filter((c) => c[0].data.body.includes("בשני הערוצים")).length;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  signed.APP = false;
  signed.EMAIL_PDF = false;
  openSteps = new Set([SIGN_STEP, PDF_STEP]);
  wireTask();
});

describe("the PDF step, in either order", () => {
  it("app first, PDF second: closes when the PDF is recorded", async () => {
    signed.APP = true;
    await lifecycle.onConfidentialitySigned("emp");
    expect(closedPdfStep()).toBe(0);

    signed.EMAIL_PDF = true;
    await lifecycle.onPdfSignatureRecorded("emp", "CONFIDENTIALITY", "agr");
    expect(openSteps.has(PDF_STEP)).toBe(false);
    expect(bothChannelsNotes()).toBe(1);
  });

  it("PDF first, app second: closes when the app signature arrives", async () => {
    signed.EMAIL_PDF = true;
    await lifecycle.onPdfSignatureRecorded("emp", "CONFIDENTIALITY", "agr");
    expect(openSteps.has(PDF_STEP)).toBe(true);

    signed.APP = true;
    await lifecycle.onConfidentialitySigned("emp");
    expect(openSteps.has(PDF_STEP)).toBe(false);
    expect(completeStepAsSystem).toHaveBeenCalledWith("step5", "confidentiality_app_signed_after_pdf");
    expect(bothChannelsNotes()).toBe(1);
  });

  it("is idempotent: repeated events close it once and note it once", async () => {
    signed.APP = true;
    signed.EMAIL_PDF = true;
    await lifecycle.onConfidentialitySigned("emp");
    await lifecycle.onPdfSignatureRecorded("emp", "CONFIDENTIALITY", "agr");
    await lifecycle.onConfidentialitySigned("emp");
    expect(openSteps.has(PDF_STEP)).toBe(false);
    expect(bothChannelsNotes()).toBe(1);
  });

  it("leaves the step open while only one channel is signed", async () => {
    signed.APP = true;
    await lifecycle.onConfidentialitySigned("emp");
    await lifecycle.onConfidentialitySigned("emp");
    expect(openSteps.has(PDF_STEP)).toBe(true);
    expect(bothChannelsNotes()).toBe(0);
  });
});
