import { describe, expect, it } from "vitest";
import { attentionSentence, hasAttention, isStaleUncertain } from "@/lib/client-file-attention";

describe("client file attention", () => {
  const now = new Date("2026-10-14T05:00:00Z");

  it("an uncertain item goes stale after two weeks without a change", () => {
    expect(isStaleUncertain({ knowledgeStatus: "UNCERTAIN", updatedAt: new Date("2026-09-29T05:00:00Z") }, now)).toBe(true);
    expect(isStaleUncertain({ knowledgeStatus: "UNCERTAIN", updatedAt: new Date("2026-10-01T05:00:00Z") }, now)).toBe(false);
    expect(isStaleUncertain({ knowledgeStatus: "MISSING", updatedAt: new Date("2026-01-01T00:00:00Z") }, now)).toBe(false);
  });

  it("says only the counts that are not zero, most urgent first, in Hebrew number agreement", () => {
    expect(attentionSentence({ pastValidity: 1, staleUncertain: 0, openQuestions: 3 })).toBe(
      "פריט זמני אחד עבר את התוקף שלו. עדיין נכון? 3 שאלות פתוחות עדיין בלי תשובה."
    );
    expect(attentionSentence({ pastValidity: 0, staleUncertain: 2, openQuestions: 1 })).toBe(
      "שאלה פתוחה אחת עדיין בלי תשובה. 2 פריטים לא ודאיים כבר יותר מ-14 יום."
    );
    expect(hasAttention({ pastValidity: 0, staleUncertain: 0, openQuestions: 0 })).toBe(false);
  });
});
