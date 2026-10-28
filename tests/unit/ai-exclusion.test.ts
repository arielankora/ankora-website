import { describe, expect, it } from "vitest";
import { NO_AI_MEETING_MARKER, NO_AI_MEETING_RULE, documentAiExclusion, taskAiExclusion } from "@/lib/ai-exclusion";
import { sourcesRules } from "@/lib/advance-prompt";

/**
 * "בלי AI" is set on one level and inherited by everything under it. The
 * inheritance is computed when read, so these are the cases a client would
 * find first if it were wrong: a step under a marked task, a document on a
 * marked task, anything of a marked client.
 */
const off = { aiExcluded: false };
const on = { aiExcluded: true };

describe("taskAiExclusion", () => {
  it("is null when nothing is marked", () => {
    expect(taskAiExclusion({ aiExcluded: false, parent: null, client: off })).toBeNull();
  });

  it("marks the task itself", () => {
    expect(taskAiExclusion({ aiExcluded: true, parent: null, client: off })).toBe("TASK");
  });

  it("a step inherits its task's mark", () => {
    expect(taskAiExclusion({ aiExcluded: false, parent: on, client: off })).toBe("PARENT_TASK");
  });

  it("the client's mark wins over everything", () => {
    expect(taskAiExclusion({ aiExcluded: true, parent: on, client: on })).toBe("CLIENT");
    expect(taskAiExclusion({ aiExcluded: false, parent: null, client: on })).toBe("CLIENT");
  });
});

describe("documentAiExclusion", () => {
  it("is null for an unmarked document with no task", () => {
    expect(documentAiExclusion({ aiExcluded: false, task: null, client: off })).toBeNull();
  });

  it("marks the document itself", () => {
    expect(documentAiExclusion({ aiExcluded: true, task: null, client: off })).toBe("DOCUMENT");
  });

  it("inherits from its task, and from the task above a step", () => {
    expect(documentAiExclusion({ aiExcluded: false, task: { aiExcluded: true, parent: null }, client: off })).toBe("TASK");
    expect(documentAiExclusion({ aiExcluded: false, task: { aiExcluded: false, parent: on }, client: off })).toBe("PARENT_TASK");
  });

  it("inherits from its client", () => {
    expect(documentAiExclusion({ aiExcluded: false, task: { aiExcluded: false, parent: null }, client: on })).toBe("CLIENT");
  });
});

// Calls are still recorded (Ariel, 28.10.2026); a meeting where a marked
// subject came up carries "[בלי AI]" in its title, and every prompt that
// may search Fireflies says not to open it.
describe("a meeting marked בלי AI", () => {
  it("the advance prompt's sources section says to leave it unopened", () => {
    const text = sourcesRules(
      { clientName: "NUX", taskId: "t1" },
      { clientDomains: [], partnerDomains: [], keywords: [], driveFolderId: null, conversationsDocId: null, fromLabel: "13.07.2026", fromIso: "2026-07-13" }
    ).join("\n");
    expect(text).toContain(NO_AI_MEETING_RULE);
    expect(text).toContain(NO_AI_MEETING_MARKER);
  });
});
