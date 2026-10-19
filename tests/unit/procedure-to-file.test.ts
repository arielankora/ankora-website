import { describe, expect, it } from "vitest";
import {
  isMappingTask,
  procedureReminderKind,
  reminderForClaude,
  reminderForScreen,
  type ProcedureCheckFacts,
} from "@/lib/procedure-to-file";

// 19.10.2026: a procedure filed on a task is proposed to the client file
// before the task closes, and closing reminds when it was not.

const facts = (over: Partial<ProcedureCheckFacts> = {}): ProcedureCheckFacts => ({
  closing: true,
  policyDocumentIds: [],
  isMapping: false,
  hasProposalFromTask: false,
  ...over,
});

describe("isMappingTask()", () => {
  it("recognises the handover line the plan writes into the description", () => {
    expect(isMappingTask("פרטים\n\n---\n\n**HND-029** | שלב: מיפוי וצפייה | מאשר: אריאל")).toBe(true);
  });

  it("is not fooled by a task that only mentions mapping", () => {
    expect(isMappingTask("מיפוי SaaS, Admin ומשתמשים")).toBe(false);
    expect(isMappingTask("**HND-010** | שלב: ביצוע עצמאי")).toBe(false);
    expect(isMappingTask(null)).toBe(false);
  });
});

describe("procedureReminderKind()", () => {
  it("reminds about a policy document that was never proposed", () => {
    expect(procedureReminderKind(facts({ policyDocumentIds: ["d1"] }))).toBe("PROCEDURE");
  });

  it("reminds about a mapping task even without a document", () => {
    expect(procedureReminderKind(facts({ isMapping: true }))).toBe("MAPPING");
  });

  it("a procedure wins over mapping when both apply", () => {
    expect(procedureReminderKind(facts({ policyDocumentIds: ["d1"], isMapping: true }))).toBe("PROCEDURE");
  });

  it("stays quiet once something was proposed from the task", () => {
    expect(procedureReminderKind(facts({ policyDocumentIds: ["d1"], isMapping: true, hasProposalFromTask: true }))).toBeNull();
  });

  it("stays quiet when the task is not closing, or has nothing to propose", () => {
    expect(procedureReminderKind(facts({ closing: false, policyDocumentIds: ["d1"] }))).toBeNull();
    expect(procedureReminderKind(facts())).toBeNull();
  });
});

describe("the reminder's words", () => {
  it("tells Claude exactly what to send, with the ids it needs, and that it may send it", () => {
    const p = reminderForClaude("PROCEDURE", "t1", ["d1"]);
    expect(p).toContain("propose_knowledge");
    expect(p).toContain("ANKORA_DOCUMENT");
    expect(p).toContain("documentId d1");
    const m = reminderForClaude("MAPPING", "t1", []);
    expect(m).toContain("kind TASK");
    expect(m).toContain("taskId t1");
  });

  it("speaks Hebrew on the screen, with no long dashes", () => {
    for (const k of ["PROCEDURE", "MAPPING"] as const) {
      const text = reminderForScreen(k) + reminderForClaude(k, "t1", ["d1"]);
      expect(text).not.toMatch(/[\u2013\u2014]/);
    }
    expect(reminderForScreen("PROCEDURE")).toContain("תיק הלקוח");
  });
});
