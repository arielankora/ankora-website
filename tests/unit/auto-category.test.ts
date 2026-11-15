import { describe, expect, it, vi, afterEach } from "vitest";
import type { User } from "@prisma/client";

// lib/app-domain/auto-category.ts (15.11.2026): the category a task gets
// when it is born without one (a task opened from WhatsApp messages). The
// pick itself is tested in tests/unit/mcp; what is pinned here is the
// wrapper's promise: it passes the words through, and it never throws, so
// a failed pick leaves the task without a category instead of failing its
// creation.

const autoPick = vi.fn();
vi.mock("@/lib/mcp/lookup", () => ({ autoPickCategory: (...a: unknown[]) => autoPick(...a) }));

import { pickCategoryForTask } from "@/lib/app-domain/auto-category";

const actor = { id: "u1" } as User;

afterEach(() => autoPick.mockReset());

describe("pickCategoryForTask", () => {
  it("returns the pick for the task's client and words", async () => {
    autoPick.mockResolvedValue({ id: "cat-1", name: "ייעוץ", basis: "title", confidence: "high" });
    const pick = await pickCategoryForTask(actor, "client-1", "מסמך העסקה\nהערות מהלקוח");
    expect(pick).toMatchObject({ id: "cat-1", name: "ייעוץ" });
    expect(autoPick).toHaveBeenCalledWith(actor, "client-1", "מסמך העסקה\nהערות מהלקוח");
  });

  it("returns null when the client has no usable category", async () => {
    autoPick.mockResolvedValue(null);
    expect(await pickCategoryForTask(actor, "client-1", "משהו")).toBeNull();
  });

  it("returns null instead of throwing when the pick fails", async () => {
    autoPick.mockRejectedValue(new Error("db down"));
    expect(await pickCategoryForTask(actor, "client-1", "משהו")).toBeNull();
  });
});
