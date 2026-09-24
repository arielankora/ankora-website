import { describe, expect, it } from "vitest";
import { portalHeadline } from "@/lib/app-domain/portal-labels";

// The one sentence at the top of the client's portal.
//
// It earned a test the way most sentences do: it said something that was
// not true. A real client with no open decisions and one promise waiting
// on them read "דבר אחד מחכה להחלטה שלך", followed that to the decisions
// tab, and was told there were no decisions waiting. Two different things
// were being counted together and then described as one of them.
//
// So the rule this file holds is narrow and worth stating plainly: the
// word "החלטה" appears only when a decision actually exists.

describe("the portal's headline", () => {
  it("never says decision when there is no decision", () => {
    for (const waiting of [1, 2, 7]) {
      expect(portalHeadline(0, waiting, 0)).not.toContain("החלט");
    }
  });

  it("names decisions when they are the only thing waiting", () => {
    expect(portalHeadline(1, 0, 0)).toBe("החלטה אחת מחכה לך.");
    expect(portalHeadline(3, 0, 0)).toBe("3 החלטות מחכות לך.");
  });

  it("counts a waiting promise without calling it a decision", () => {
    expect(portalHeadline(0, 1, 0)).toBe("דבר אחד מחכה לך.");
    expect(portalHeadline(0, 2, 0)).toBe("2 דברים מחכים לך.");
  });

  it("counts both together rather than picking one of their names", () => {
    // A client holding a decision AND a waiting promise is holding two
    // things. Saying "decision" would under-describe the second; saying
    // "promise" would under-describe the first.
    expect(portalHeadline(1, 1, 0)).toBe("2 דברים מחכים לך.");
    expect(portalHeadline(2, 3, 4)).toBe("5 דברים מחכים לך.");
  });

  it("says what is happening when nothing needs the client", () => {
    expect(portalHeadline(0, 0, 0)).toBe("הכל מטופל. אין כרגע דבר שדורש פעולה מצדך.");
    expect(portalHeadline(0, 0, 1)).toBe("הבטחה אחת בטיפול. אין דבר שמחכה לך.");
    expect(portalHeadline(0, 0, 5)).toBe("5 הבטחות בטיפול. אין דבר שמחכה לך.");
  });

  it("never promises action from a client who has nothing to do", () => {
    // The quiet states are the ones a client reads most often, and a
    // sentence that hints at work when there is none is the portal
    // creating the mental load it exists to remove.
    for (const inProgress of [0, 1, 4]) {
      expect(portalHeadline(0, 0, inProgress)).toContain("אין");
    }
  });
});
