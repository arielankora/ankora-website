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
