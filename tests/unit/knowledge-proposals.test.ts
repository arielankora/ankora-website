import { describe, expect, it } from "vitest";
import { FactPayload, firefliesLink, normalizeForMatch, payloadText, proposalHeadline, secondsOf } from "@/lib/knowledge-proposals";

describe("knowledge proposals, pure parts", () => {
  it("opens a recording at the minute", () => {
    expect(secondsOf("08:13")).toBe(493);
    expect(secondsOf("1:02:03")).toBe(3723);
    expect(secondsOf("soon")).toBeNull();
    expect(firefliesLink("abc123", "08:13")).toBe("https://app.fireflies.ai/view/abc123?t=493");
    expect(firefliesLink("abc123")).toBe("https://app.fireflies.ai/view/abc123");
  });

  it("matches the same fact through case, spacing and punctuation", () => {
    expect(normalizeForMatch("WhatsApp,  אחר כך Slack!")).toBe(normalizeForMatch("whatsapp אחר כך slack"));
    expect(normalizeForMatch("Slack")).not.toBe(normalizeForMatch("WhatsApp"));
  });

  it("collects every string a payload carries, for the secret scan", () => {
    expect(payloadText({ name: "שני", emails: ["a@b.co"], nested: { context: "x" }, isPrimary: true })).toBe("שני\na@b.co\nx");
  });

  it("names a proposal by its main line", () => {
    expect(proposalHeadline("CONTACT", { name: "שני", role: "VP Finance" })).toBe("שני, VP Finance");
    expect(proposalHeadline("SYSTEM", { systemName: "Mercury" })).toBe("Mercury");
  });

  it("refuses a fact without words or with an unknown kind", () => {
    expect(FactPayload.safeParse({ kind: "NOTE", body: "" }).success).toBe(false);
    expect(FactPayload.safeParse({ kind: "GOSSIP", body: "x" }).success).toBe(false);
    expect(FactPayload.safeParse({ kind: "TEMPORARY", body: "x", validUntil: "2026-12-01" }).success).toBe(true);
    expect(FactPayload.safeParse({ kind: "TEMPORARY", body: "x", validUntil: "1.12.2026" }).success).toBe(false);
  });
});

describe("the new targets on the review card", () => {
  it("a process shows its trigger and steps, an entity its identifiers, a long text in full", async () => {
    const { proposalDetails, proposalHeadline, PAYLOADS } = await import("@/lib/knowledge-proposals");
    const proc = { title: "תשלומי ספקים", triggerText: "ב-10 וב-25", steps: [{ title: "מעלים" }, { title: "חותמים", requiresApproval: true }] };
    expect(PAYLOADS.PROCESS.safeParse(proc).success).toBe(true);
    expect(proposalHeadline("PROCESS", proc)).toBe("תשלומי ספקים");
    expect(proposalDetails("PROCESS", proc)).toEqual(["מה מפעיל: ב-10 וב-25", "1. מעלים", "2. חותמים (דורש אישור)"]);
    expect(proposalDetails("ENTITY", { name: "NUX.AI Ltd", country: "IL", parentName: "NUX Inc" })).toEqual(["IL", "בת של NUX Inc"]);
    const long = "א".repeat(200);
    expect(proposalHeadline("NARRATIVE", { kind: "OVERVIEW", body: long })).toHaveLength(160);
    expect(proposalDetails("NARRATIVE", { kind: "OVERVIEW", body: long })).toEqual([long]);
    expect(PAYLOADS.DOMAIN.safeParse({ domain: "nux.ai", kind: "VENDOR" }).success).toBe(false);
  });
});

describe("what blocks approval (spec 5.2)", () => {
  it("a cited code not in the register, and an item missing what makes it whole, block; a process's procedure only warns", async () => {
    const { proposalProblems, bulkApproveBlocker } = await import("@/lib/knowledge-proposals");
    const r17 = proposalProblems("NARRATIVE", { kind: "OVERVIEW", body: "חברה [S1 02:00] עם שתי ישויות [S9]" }, ["S1"]);
    expect(r17).toEqual([expect.objectContaining({ code: "R17", block: true })]);
    expect(r17[0].message).toContain("S9");
    expect(proposalProblems("FACT", { kind: "TEMPORARY", body: "Anthropic בכרטיס הפרטי" }, [])[0]).toMatchObject({ code: "SHAPE", block: true });
    expect(proposalProblems("FACT", { kind: "TEMPORARY", body: "x", validUntilEvent: "עד הצירוף" }, [])).toEqual([]);
    expect(proposalProblems("POLICY", { kind: "THRESHOLD", title: "תוכנה", statement: "עד 3,000$" }, [])[0]).toMatchObject({ block: true });
    const proc = proposalProblems("PROCESS", { title: "תשלום", steps: [{ title: "משלמים", mode: "AUTOMATED", actionTags: ["PAYMENT"] }] }, []);
    expect(proc.map((f) => [f.code, !!f.block])).toEqual([
      ["R1", false],
      ["R3", false],
    ]);
    expect(bulkApproveBlocker({ action: "CREATE", flags: r17, payload: {} })).toContain("חוסם");
  });
});

describe("decision 1's measure", () => {
  it("says the share edited, the end of the first month, and then where it stands", async () => {
    const { qualityLine } = await import("@/lib/knowledge-proposals");
    const now = new Date("2026-11-30T10:00:00Z");
    expect(qualityLine({ approved: 0, editedBeforeApproval: 0, rejected: 0, firstDecidedAt: null }, now).tone).toBe("neutral");
    const early = qualityLine({ approved: 40, editedBeforeApproval: 3, rejected: 5, firstDecidedAt: new Date("2026-11-15T00:00:00Z") }, now);
    expect(early.text).toContain("40 אושרו, 3 מהן אחרי עריכה (7.5%), 5 נדחו");
    expect(early.text).toContain("החודש הראשון נגמר ב-15.12.2026");
    const after = new Date("2026-10-17T00:00:00Z");
    expect(qualityLine({ approved: 100, editedBeforeApproval: 5, rejected: 2, firstDecidedAt: after }, now).tone).toBe("good");
    expect(qualityLine({ approved: 100, editedBeforeApproval: 15, rejected: 2, firstDecidedAt: after }, now).tone).toBe("warn");
  });
});
