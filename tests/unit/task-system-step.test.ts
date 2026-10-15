import { beforeEach, describe, expect, it, vi } from "vitest";

// completeStepAsSystem: the one way a task closes without a person, used
// by the employee lifecycle. It must stay narrow enough that it can never
// close a promise a client can see, or a task in its own right.

const findFirst = vi.fn();
const update = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: { task: { findFirst: (a: unknown) => findFirst(a), update: (a: unknown) => update(a) } } }));
const recordAudit = vi.fn();
vi.mock("@/lib/app-auth/audit", () => ({ recordAudit: (a: unknown) => recordAudit(a) }));

const { completeStepAsSystem } = await import("@/lib/app-domain/tasks");

const step = (o: Record<string, unknown> = {}) => ({
  id: "s1",
  parentId: "p1",
  clientId: "c1",
  clientVisible: false,
  status: "OPEN",
  ...o,
});

beforeEach(() => vi.clearAllMocks());

describe("completeStepAsSystem", () => {
  it("closes an open internal step and audits it with no actor", async () => {
    findFirst.mockResolvedValue(step());
    await expect(completeStepAsSystem("s1", "why")).resolves.toBe(true);
    expect(update.mock.calls[0][0].data.status).toBe("DONE");
    expect(update.mock.calls[0][0].data.completedAt).toBeInstanceOf(Date);
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ actorId: null, action: "task.status_change", entityId: "s1" }));
  });

  it("refuses a task in its own right, a client-visible step and a closed one", async () => {
    for (const row of [step({ parentId: null }), step({ clientVisible: true }), step({ status: "DONE" }), null]) {
      findFirst.mockResolvedValueOnce(row);
      await expect(completeStepAsSystem("s1", "why")).resolves.toBe(false);
    }
    expect(update).not.toHaveBeenCalled();
  });
});
