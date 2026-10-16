import { beforeEach, describe, expect, it, vi } from "vitest";

// getEmployeeStatus: one person's lifecycle state for an agent. The two
// things that matter most are the gate, and what is NOT in the answer:
// the personal email, IPs, browsers, hashes.

const db = {
  user: { findFirst: vi.fn() },
  passkey: { count: vi.fn() },
  task: { findMany: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma: db }));
const getAgreementStatus = vi.fn();
const pendingPdfUploads = vi.fn();
vi.mock("@/lib/app-domain/agreements", () => ({
  getAgreementStatus: (id: string) => getAgreementStatus(id),
  pendingPdfUploads: (id: string) => pendingPdfUploads(id),
}));
vi.mock("@/lib/app-domain/tasks", () => ({ OPEN_STATUSES: ["OPEN", "IN_PROGRESS", "PENDING_APPROVAL"] }));

const { getEmployeeStatus, EmployeeNotFoundError } = await import("@/lib/app-domain/employee-status");
const { ForbiddenError } = await import("@/lib/app-auth/permissions");

const NOW = new Date("2026-10-15T09:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findFirst.mockResolvedValue({
    id: "u1",
    name: "דנה כהן",
    email: "dana@ankora.co.il",
    role: "ANKORA_EMPLOYEE",
    status: "ACTIVE",
    lastLoginAt: new Date("2026-10-13T21:30:00Z"), // 14.10 at 00:30 in Israel
    lastSeenAt: new Date("2026-10-15T06:00:00Z"), // this morning
    personalEmail: "dana.private@example.com",
  });
  db.passkey.count.mockResolvedValue(1);
  pendingPdfUploads.mockResolvedValue({
    CONFIDENTIALITY: [{ documentId: "doc-9", uploadedAt: new Date("2026-10-15T08:30:00Z") }],
    DELETION_DECLARATION: [],
  });
  getAgreementStatus.mockResolvedValue([
    {
      kind: "CONFIDENTIALITY",
      currentVersion: "סודיות-1.0",
      app: true,
      emailPdf: false,
      appLatest: { version: "סודיות-1.0", signedAt: new Date("2026-10-14T08:00:00Z") },
      emailPdfLatest: null,
    },
  ]);
  db.task.findMany.mockResolvedValue([
    {
      id: "t1",
      title: "קליטת עובד: דנה כהן",
      lifecycleKind: "ONBOARDING",
      dueDate: new Date("2026-10-22T00:00:00Z"),
      subtasks: [
        { title: "שלב א", status: "DONE" },
        { title: "שלב ב", status: "OPEN" },
        { title: "בוטל", status: "ARCHIVED" },
      ],
    },
  ]);
});

describe("getEmployeeStatus", () => {
  it("is for managers and admins only, and reads nothing otherwise", async () => {
    await expect(getEmployeeStatus({ role: "ANKORA_EMPLOYEE" }, "u1", NOW)).rejects.toBeInstanceOf(ForbiddenError);
    expect(db.user.findFirst).not.toHaveBeenCalled();
  });

  it("never finds a client portal user", async () => {
    db.user.findFirst.mockResolvedValue(null);
    await expect(getEmployeeStatus({ role: "SUPER_ADMIN" }, "client", NOW)).rejects.toBeInstanceOf(EmployeeNotFoundError);
    expect(db.user.findFirst.mock.calls[0][0].where.role).toEqual({ not: "CLIENT_USER" });
  });

  it("returns the shape an agent reads", async () => {
    const out = await getEmployeeStatus({ role: "ANKORA_ADMIN" }, "u1", NOW);
    expect(out).toMatchObject({
      id: "u1",
      role: "ANKORA_EMPLOYEE",
      status: "ACTIVE",
      lastLoginAt: "2026-10-13T21:30:00.000Z",
      daysSinceLogin: 1,
      lastSeenAt: "2026-10-15T06:00:00.000Z",
      daysSinceSeen: 0,
      personalEmailOnFile: true,
      passkeyCount: 1,
    });
    expect(out.agreements[0]).toEqual({
      kind: "CONFIDENTIALITY",
      currentVersion: "סודיות-1.0",
      appSignedCurrent: true,
      emailPdfSignedCurrent: false,
      app: { version: "סודיות-1.0", signedAt: "2026-10-14T08:00:00.000Z" },
      emailPdf: null,
      pendingPdfUploads: [{ documentId: "doc-9", uploadedAt: "2026-10-15T08:30:00.000Z" }],
    });
    expect(out.lifecycleTasks).toEqual([
      expect.objectContaining({
        taskId: "t1",
        kind: "ONBOARDING",
        due: "2026-10-22",
        stepsDone: 1,
        stepsTotal: 2,
        openSteps: ["שלב ב"],
      }),
    ]);
    expect(out.lifecycleTasks[0].url).toMatch(/\/app\/tasks\/t1$/);
    expect(out.adminPageUrl).toMatch(/\/app\/users\/u1$/);
  });

  it("never carries the personal email, a password hash or anything from a signature row beyond version and date", async () => {
    const out = JSON.stringify(await getEmployeeStatus({ role: "SUPER_ADMIN" }, "u1", NOW));
    expect(out).not.toContain("dana.private");
    for (const field of ["passwordHash", "ip", "userAgent", "contentHash", "driveFileId", "personalEmail\""]) {
      expect(out).not.toContain(`"${field.replace(/"$/, "")}"`);
    }
    expect(db.user.findFirst.mock.calls[0][0].select.passwordHash).toBeUndefined();
  });
});
