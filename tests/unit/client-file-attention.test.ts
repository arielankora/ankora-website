import { describe, expect, it } from "vitest";
import { attentionSentence, hasAttention, isStaleProposal, isStaleProposedRule, isStaleUncertain } from "@/lib/client-file-attention";

describe("client file attention", () => {
  const now = new Date("2026-10-14T05:00:00Z");

  it("an uncertain item goes stale after two weeks without a change", () => {
    expect(isStaleUncertain({ knowledgeStatus: "UNCERTAIN", updatedAt: new Date("2026-09-29T05:00:00Z") }, now)).toBe(true);
    expect(isStaleUncertain({ knowledgeStatus: "UNCERTAIN", updatedAt: new Date("2026-10-01T05:00:00Z") }, now)).toBe(false);
    expect(isStaleUncertain({ knowledgeStatus: "MISSING", updatedAt: new Date("2026-01-01T00:00:00Z") }, now)).toBe(false);
  });

  it("says only the counts that are not zero, most urgent first, in Hebrew number agreement", () => {
    expect(attentionSentence({ pastValidity: 1, staleUncertain: 0, openQuestions: 3, staleProposedRules: 0 })).toBe(
      "פריט זמני אחד עבר את התוקף שלו. עדיין נכון? 3 שאלות פתוחות עדיין בלי תשובה."
    );
    expect(attentionSentence({ pastValidity: 0, staleUncertain: 2, openQuestions: 1, staleProposedRules: 0 })).toBe(
      "שאלה פתוחה אחת עדיין בלי תשובה. 2 פריטים לא ודאיים כבר יותר מ-14 יום."
    );
    expect(hasAttention({ pastValidity: 0, staleUncertain: 0, openQuestions: 0, staleProposedRules: 0 })).toBe(false);
  });

  it("a rule proposed two weeks ago and not approved is said, with what applies meanwhile", () => {
    expect(isStaleProposedRule({ status: "PROPOSED", createdAt: new Date("2026-09-29T05:00:00Z") }, now)).toBe(true);
    expect(isStaleProposedRule({ status: "ACTIVE", createdAt: new Date("2026-01-01T00:00:00Z") }, now)).toBe(false);
    expect(isStaleProposedRule({ status: "PROPOSED", createdAt: new Date("2026-10-10T00:00:00Z") }, now)).toBe(false);
    expect(attentionSentence({ pastValidity: 0, staleUncertain: 0, openQuestions: 0, staleProposedRules: 1 })).toBe("כלל מוצע אחד מחכה לאישור כבר יותר מ-14 יום, ועד אז חל רק כלל הביניים.");
    expect(hasAttention({ pastValidity: 0, staleUncertain: 0, openQuestions: 0, staleProposedRules: 2 })).toBe(true);
  });

  it("a proposal waiting more than a week on the review screen is said (20.10.2026)", () => {
    expect(isStaleProposal({ state: "PENDING", createdAt: new Date(now.getTime() - 8 * 86400000) }, now)).toBe(true);
    expect(isStaleProposal({ state: "PENDING", createdAt: new Date(now.getTime() - 6 * 86400000) }, now)).toBe(false);
    expect(isStaleProposal({ state: "REJECTED", createdAt: new Date("2026-01-01T00:00:00Z") }, now)).toBe(false);
    const a = { pastValidity: 0, staleUncertain: 0, openQuestions: 0, staleProposedRules: 0 };
    expect(hasAttention({ ...a, staleProposals: 1 })).toBe(true);
    expect(attentionSentence({ ...a, staleProposals: 1 })).toBe("הצעה אחת מחכה במסך הבדיקה כבר יותר מ-7 ימים, ועד שתאושר היא לא בתיק.");
    expect(attentionSentence({ ...a, staleProposals: 3 })).toBe("3 הצעות מחכות במסך הבדיקה כבר יותר מ-7 ימים, ועד שיאושרו הן לא בתיק.");
  });
});
