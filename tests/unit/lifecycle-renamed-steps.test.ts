import { beforeEach, describe, expect, it, vi } from "vitest";

// 5.11.2026: an approved work plan rewrote the onboarding steps in its own
// words, and the PDF step stayed open after both signatures, because the
// system looked for it only by its original title. It now falls back to
// what the step is about, and when that is not one clear step it says so
// on the task instead of guessing.

const signed = { APP: true, EMAIL_PDF: true };
let steps: { id: string; title: string; open: boolean }[] = [];

const db = {
  employeeAgreement: {
    findFirst: vi.fn(async (args: { where: { channel: "APP" | "EMAIL_PDF" } }) => (signed[args.where.channel] ? { id: "sig" } : null)),
  },
  task: {
    findFirst: vi.fn(async (args: { where: { subjectUserId?: string; title?: string } }) => {
      if (args.where.subjectUserId) return { id: "onb", clientId: "internal" };
      const s = steps.find((x) => x.open && x.title === args.where.title);
      return s ? { id: s.id } : null;
    }),
    findMany: vi.fn(async () => steps.filter((s) => s.open).map(({ id, title }) => ({ id, title }))),
  },
  taskComment: { create: vi.fn(async (_args: { data: { body: string } }) => ({ id: "c" })) },
  passkey: { count: vi.fn(async () => 1) },
};
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/app-auth/audit", () => ({ recordAudit: vi.fn() }));

const completeStepAsSystem = vi.fn(async (id: string) => {
  const s = steps.find((x) => x.id === id && x.open);
  if (!s) return false;
  s.open = false;
  return true;
});
vi.mock("@/lib/app-domain/tasks", () => ({
  OPEN_STATUSES: ["OPEN", "IN_PROGRESS", "PENDING_APPROVAL"],
  createTask: vi.fn(),
  updateTask: vi.fn(),
  assignableUsers: vi.fn(),
  completeStepAsSystem: (id: string) => completeStepAsSystem(id),
}));
vi.mock("@/lib/app-domain/mcp-connections", () => ({ revokeClaudeGrantsForUser: vi.fn() }));

const lifecycle = await import("@/lib/app-domain/employee-lifecycle");

// The steps as Maor Sharan's plan left them (5.11.2026), open ones only
// matter here.
const PLAN_STEPS = [
  { id: "email", title: "לנסח מייל למאור עם ההתחייבות לסודיות כ-PDF וקוד העלאה", open: true },
  { id: "contract", title: "לתייק את הסכם ההתקשרות החתום", open: true },
  { id: "pdf", title: "לבדוק את ה-PDF החתום ולרשום אותו", open: true },
  { id: "tools", title: "לתת גישות לכלים לפי התפקיד ולרשום אותן", open: true },
  { id: "pol", title: "להחתים על ANKORA-POL-1.0 עם הצהרת מכשיר", open: true },
];

const comments = () => db.taskComment.create.mock.calls.map((c) => c[0].data.body);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  signed.APP = true;
  signed.EMAIL_PDF = true;
  steps = PLAN_STEPS.map((s) => ({ ...s }));
});

describe("looksLikeLifecycleStep", () => {
  it("recognises the PDF step in its original and its plan wording", () => {
    expect(lifecycle.looksLikeLifecycleStep("pdf", "קבלת ה-PDF החתום, בדיקת גרסה ותיוק")).toBe(true);
    expect(lifecycle.looksLikeLifecycleStep("pdf", "לבדוק את ה-PDF החתום ולרשום אותו")).toBe(true);
  });

  it("never takes the email that sends the blank form, or another signed document", () => {
    expect(lifecycle.looksLikeLifecycleStep("pdf", "לנסח מייל למאור עם ההתחייבות לסודיות כ-PDF וקוד העלאה")).toBe(false);
    expect(lifecycle.looksLikeLifecycleStep("pdf", "מייל לספק הפנימי עם ההתחייבות לסודיות כ-PDF לחתימה")).toBe(false);
    expect(lifecycle.looksLikeLifecycleStep("pdf", "לתייק את הסכם ההתקשרות החתום")).toBe(false);
  });

  it("recognises the sign step by its passkey", () => {
    expect(lifecycle.looksLikeLifecycleStep("sign", "אישור ההתחייבות באפליקציה והגדרת passkey")).toBe(true);
    expect(lifecycle.looksLikeLifecycleStep("sign", "להגדיר Passkey ולאשר באפליקציה")).toBe(true);
    expect(lifecycle.looksLikeLifecycleStep("sign", "לתת גישות לכלים")).toBe(false);
  });
});

describe("a renamed PDF step", () => {
  it("closes when the PDF completes both signatures", async () => {
    await lifecycle.onPdfSignatureRecorded("emp", "CONFIDENTIALITY", "agr");
    expect(completeStepAsSystem).toHaveBeenCalledWith("pdf");
    expect(steps.find((s) => s.id === "email")!.open).toBe(true);
    expect(comments().some((b) => b.includes("השלב נסגר"))).toBe(true);
  });

  it("is left alone, with a note, when two open steps read like it", async () => {
    steps.push({ id: "pdf2", title: "לקבל את ה-PDF החתום מהספק", open: true });
    await lifecycle.onPdfSignatureRecorded("emp", "CONFIDENTIALITY", "agr");
    expect(completeStepAsSystem).not.toHaveBeenCalled();
    expect(comments().some((b) => b.includes("יש לסגור אותו ידנית"))).toBe(true);
  });

  it("does nothing when no open step reads like it", async () => {
    steps = steps.filter((s) => s.id !== "pdf");
    await lifecycle.onPdfSignatureRecorded("emp", "CONFIDENTIALITY", "agr");
    expect(completeStepAsSystem).not.toHaveBeenCalled();
    expect(comments()).toEqual([]);
  });
});

describe("a renamed sign step", () => {
  it("closes on the in-app signature when a passkey exists", async () => {
    signed.EMAIL_PDF = false;
    steps.push({ id: "sign", title: "לאשר באפליקציה ולהגדיר passkey", open: true });
    await lifecycle.onConfidentialitySigned("emp");
    expect(completeStepAsSystem).toHaveBeenCalledWith("sign");
    expect(comments().some((b) => b.includes("השלב נסגר"))).toBe(true);
  });

  it("does not claim to have closed a step it could not find", async () => {
    signed.EMAIL_PDF = false;
    await lifecycle.onConfidentialitySigned("emp");
    expect(completeStepAsSystem).not.toHaveBeenCalled();
    expect(comments().some((b) => b.includes("השלב נסגר"))).toBe(false);
    expect(comments().some((b) => b.includes("לא נסגר שלב"))).toBe(true);
  });
});
