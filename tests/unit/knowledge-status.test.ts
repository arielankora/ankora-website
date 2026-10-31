import { describe, expect, it } from "vitest";
import { missingRequired, resolveKnowledgeStatus, statusFromConfidence } from "@/lib/knowledge-proposals";

// 31.10.2026: where an item's status may be sent, and what it is when it
// is not sent at all.

describe("resolveKnowledgeStatus", () => {
  const fact = (extra: Record<string, unknown> = {}, payload: Record<string, unknown> = {}) => ({ target: "FACT" as const, payload: { kind: "NOTE", body: "x", ...payload }, ...extra });

  it("takes the status from confidence when none is sent: HIGH is confirmed, the rest uncertain", () => {
    expect(statusFromConfidence("HIGH")).toBe("CONFIRMED");
    expect(statusFromConfidence("MEDIUM")).toBe("UNCERTAIN");
    expect(statusFromConfidence("LOW")).toBe("UNCERTAIN");
    expect(statusFromConfidence(undefined)).toBe("UNCERTAIN");
    expect(resolveKnowledgeStatus(fact({ confidence: "HIGH" }), "items[0]")).toMatchObject({ ok: true, defaulted: true, payload: { knowledgeStatus: "CONFIRMED" } });
  });

  it("never guesses MISSING, and keeps one that was sent", () => {
    expect(resolveKnowledgeStatus(fact({ status: "MISSING", confidence: "HIGH" }))).toMatchObject({ ok: true, defaulted: false, payload: { knowledgeStatus: "MISSING" } });
  });

  it("reads status on the item, status in the payload and payload.knowledgeStatus alike, and drops the alias", () => {
    for (const item of [fact({ status: "UNCERTAIN" }), fact({}, { status: "UNCERTAIN" }), fact({}, { knowledgeStatus: "UNCERTAIN" })]) {
      const r = resolveKnowledgeStatus(item);
      expect(r).toMatchObject({ ok: true, payload: { knowledgeStatus: "UNCERTAIN" } });
      expect(r.ok && "status" in r.payload).toBe(false);
    }
  });

  it("refuses a value that is not one of the three, naming where it was", () => {
    expect(resolveKnowledgeStatus(fact({ status: "confirmed" }), "items[3]")).toEqual({ ok: false, reason: expect.stringContaining("items[3].status") });
    expect(resolveKnowledgeStatus(fact({}, { status: "YES" }), "items[3]")).toEqual({ ok: false, reason: expect.stringContaining("items[3].payload.status") });
  });

  it("refuses two that disagree", () => {
    expect(resolveKnowledgeStatus(fact({ status: "CONFIRMED" }, { knowledgeStatus: "MISSING" }))).toMatchObject({ ok: false });
    expect(resolveKnowledgeStatus(fact({ status: "CONFIRMED" }, { knowledgeStatus: "CONFIRMED" }))).toMatchObject({ ok: true });
  });

  it("adds nothing to items that carry no status", () => {
    expect(resolveKnowledgeStatus({ target: "TASK", payload: { title: "t" }, status: "CONFIRMED" }).ok && resolveKnowledgeStatus({ target: "TASK", payload: { title: "t" } })).toMatchObject({ payload: { title: "t" } });
    expect(resolveKnowledgeStatus({ target: "FACT", payload: { kind: "QUESTION", body: "?" }, confidence: "HIGH" })).toMatchObject({ ok: true, payload: { kind: "QUESTION", body: "?" } });
    expect((resolveKnowledgeStatus({ target: "DATE", payload: {}, confidence: "HIGH" }) as { payload: Record<string, unknown> }).payload.knowledgeStatus).toBeUndefined();
  });
});

describe("missingRequired", () => {
  it("names the field and its path", () => {
    expect(missingRequired("FACT", { kind: "NOTE" }, null, "items[2]")).toContain("items[2].reason");
    expect(missingRequired("FACT", { kind: "NOTE" }, "r", "items[2]")).toContain("items[2].status");
  });
});
