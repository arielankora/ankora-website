import { describe, expect, it } from "vitest";
import { documentAiExclusion, taskAiExclusion } from "@/lib/ai-exclusion";

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
