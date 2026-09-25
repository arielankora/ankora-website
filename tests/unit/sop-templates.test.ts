import { describe, expect, it } from "vitest";
import { TASK_TEMPLATES, findTemplate } from "@/lib/app-domain/sop-templates";

// The procedures from the SOP book, as data.
//
// What is worth testing here is not the wording - that is the book's
// job, and a test asserting on it would just be the book typed twice.
// What is worth testing is everything that would make a template arrive
// on somebody's task broken: an id that collides, a procedure with no
// steps, a deadline ladder that does not climb.
//
// These are cheap and they are the kind of mistake a person editing this
// file at midnight actually makes.

describe("the book, as data", () => {
  it("has procedures at all", () => {
    expect(TASK_TEMPLATES.length).toBeGreaterThanOrEqual(5);
  });

  it("gives every procedure a unique id", () => {
    // Two templates sharing an id means one of them can never be applied
    // and nobody would know which.
    const ids = TASK_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every procedure a name, a when, a source and steps", () => {
    for (const t of TASK_TEMPLATES) {
      expect(t.name.trim(), t.id).not.toBe("");
      // The line that tells somebody which situation they are in. A
      // template without it is a name to guess at.
      expect(t.when.trim(), t.id).not.toBe("");
      // The chapter in the book, so the two can be read against each
      // other when either changes. This is the whole argument for
      // keeping these in code rather than in a table.
      expect(t.sopSection.trim(), t.id).not.toBe("");
      expect(t.steps.length, t.id).toBeGreaterThan(0);
    }
  });

  it("gives every step a title, and no step an empty one", () => {
    for (const t of TASK_TEMPLATES) {
      for (const step of t.steps) {
        expect(step.title.trim(), `${t.id}: ${step.title}`).not.toBe("");
      }
    }
  });

  it("keeps a deadline ladder climbing", () => {
    // The reminders to a silent client are at one, three and seven days,
    // and the order is the procedure. A template whose second reminder
    // is due before its first is not a slower ladder, it is a wrong one:
    // both land on the same screen on the same morning.
    for (const t of TASK_TEMPLATES) {
      const dated = t.steps.map((s) => s.dueInDays).filter((d): d is number => d !== undefined);
      const climbing = [...dated].sort((a, b) => a - b);
      expect(dated, `${t.id} has deadlines out of order`).toEqual(climbing);
      for (const d of dated) {
        expect(d, `${t.id} has a deadline of ${d} days`).toBeGreaterThan(0);
      }
    }
  });

  it("finds a procedure by id, and nothing by a wrong one", () => {
    expect(findTemplate(TASK_TEMPLATES[0].id)?.id).toBe(TASK_TEMPLATES[0].id);
    expect(findTemplate("not-a-template")).toBeUndefined();
  });
});
