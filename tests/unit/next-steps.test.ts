import { describe, expect, it } from "vitest";
import { matchDateToProcess, nextSteps, rankApprovals, urgency, type ProcessFacts } from "@/lib/next-steps";

// "הצעד הבא" (22.10.2026): every gap of a process as a step with what to
// do, why, and the action; the order of the approvals screen.

function facts(over: Partial<ProcessFacts> = {}): ProcessFacts {
  return {
    id: "p5",
    code: "P5",
    title: "מעקב חופשות, מחלות ושינויים בהעסקה ודיווח חודשי לשכר",
    purpose: "לרשום כל חודש חופשות ולדווח לשכר",
    status: "ACTIVE",
    triggerKinds: ["SCHEDULED"],
    ownerId: "hadas",
    hasNextDate: true,
    draft: null,
    covered: [],
    missing: [],
    noAccess: [],
    review: null,
    openLessons: 0,
    knowledge: { uncertain: false, toResolve: null },
    dateCandidate: null,
    ...over,
  };
}

describe("next steps", () => {
  it("says a process with nothing to close is in order", () => {
    expect(nextSteps(facts(), true)).toEqual([]);
  });

  it("puts a scheduled process without a date first, and links the date that looks like its own", () => {
    const steps = nextSteps(facts({ hasNextDate: false, dateCandidate: { id: "d1", title: "שליחת טבלת השכר לדקלה (P5)" } }), true);
    expect(steps.map((s) => s.kind)).toEqual(["no_next_date"]);
    expect(steps[0]).toMatchObject({ blocking: true, fix: { kind: "op", op: { type: "link_date", processId: "p5", dateId: "d1" }, label: "לקשר" } });
    expect(steps[0].recommend).toContain("שליחת טבלת השכר");
  });

  it("asks for a date when no date of the client fits, and does not block a process not yet approved", () => {
    const [step] = nextSteps(facts({ status: "DRAFT", hasNextDate: false }), true);
    expect(step).toMatchObject({ kind: "no_next_date", blocking: false, fix: { kind: "dates" } });
    // Its procedure, waiting, comes first: that is what stops it.
    expect(nextSteps(facts({ status: "DRAFT", hasNextDate: false, draft: { version: 1, blocked: false } }), true).map((x) => x.kind)).toEqual(["procedure_draft", "no_next_date"]);
  });

  it("does not ask a process that runs on request for a date", () => {
    expect(nextSteps(facts({ triggerKinds: ["EVENT"], hasNextDate: false }), true)).toEqual([]);
  });

  it("offers to close the duplicate tasks, both at once, to a manager only", () => {
    const covered = [
      { taskId: "t1", title: "מעקב חופשות, Leave ושינויים בהעסקה" },
      { taskId: "t2", title: "דיווח שינויי עובד ל-Payroll" },
    ];
    const [forManager] = nextSteps(facts({ covered }), true);
    expect(forManager).toMatchObject({ kind: "covered_tasks", recommend: "לסגור את שתיהן", fix: { kind: "op", label: "לסגור את שתיהן", op: { type: "close_covered", taskIds: ["t1", "t2"] } } });
    const [forOwner] = nextSteps(facts({ covered }), false);
    expect(forOwner.fix.kind).toBe("open");
  });

  it("never asks for a backup (22.10.2026)", () => {
    expect(nextSteps(facts({ status: "DRAFT", triggerKinds: ["EVENT"] }), true)).toEqual([]);
  });

  it("approves a draft that passes in one click for a manager, and sends one that fails to be fixed", () => {
    expect(nextSteps(facts({ draft: { version: 2, blocked: false } }), true)[0]).toMatchObject({ kind: "procedure_draft", blocking: true, fix: { kind: "op", op: { type: "approve_procedure", version: 2 } } });
    expect(nextSteps(facts({ draft: { version: 2, blocked: false } }), false)[0].fix.kind).toBe("open");
    expect(nextSteps(facts({ draft: { version: 2, blocked: true } }), true)[0]).toMatchObject({ fix: { kind: "procedure" } });
  });

  it("marks a periodic review in one click, and sends a broken rule to a new version", () => {
    expect(nextSteps(facts({ review: { label: "הגיע מועד הסקירה", periodic: true } }), true)[0].fix).toMatchObject({ kind: "op", op: { type: "mark_reviewed" } });
    expect(nextSteps(facts({ review: { label: "לא עומד בכללים", periodic: false } }), true)[0].fix.kind).toBe("procedure");
  });

  it("orders the steps by what stops work first", () => {
    const steps = nextSteps(
      facts({
        hasNextDate: false,
        draft: { version: 3, blocked: false },
        covered: [{ taskId: "t1", title: "x" }],
        missing: ["SLA"],
        noAccess: ["JustWorks"],
        openLessons: 2,
        knowledge: { uncertain: true, toResolve: "לשאול את דקלה" },
        review: { label: "סקירה", periodic: true },
      }),
      true
    );
    expect(steps.map((s) => s.kind)).toEqual(["no_next_date", "procedure_draft", "review", "covered_tasks", "lessons", "uncertain", "missing_fields", "no_access"]);
    expect(steps.find((s) => s.kind === "missing_fields")?.title).toBe("חסר: SLA");
    expect(steps.find((s) => s.kind === "lessons")?.title).toBe("2 הערות מריצות, לגרסה הבאה");
  });
});

describe("matchDateToProcess", () => {
  const p5 = { code: "P5", title: "מעקב חופשות, מחלות ושינויים בהעסקה ודיווח חודשי לשכר", purpose: "לרשום כל חודש חופשות ולדווח לשכר" };
  it("matches a date that names the process's code", () => {
    expect(matchDateToProcess(p5, [{ id: "d0", title: "ט\"ו בשבט" }, { id: "d1", title: "שליחת טבלת השכר לדקלה (P5)" }])?.id).toBe("d1");
    // P15 is not P5.
    expect(matchDateToProcess(p5, [{ id: "d2", title: "דיווח (P15)" }])).toBeNull();
  });

  it("matches a date whose words are the process's", () => {
    const p2 = { code: "P2", title: "תשלומי ספקים בחברה הישראלית (10 ו-25 לחודש)", purpose: "ספקי החברה הישראלית משולמים פעמיים בחודש" };
    expect(matchDateToProcess(p2, [{ id: "d1", title: "תשלום ספקים LTD" }])?.id).toBe("d1");
    expect(matchDateToProcess(p2, [{ id: "d2", title: "חנוכה" }, { id: "d3", title: "יום הולדת של אורן" }])).toBeNull();
  });
});

describe("rankApprovals", () => {
  const now = new Date("2026-10-22T09:00:00Z");
  const r = (title: string, since: string, over: { blocking?: boolean; deadline?: Date | null } = {}) => ({ title, since: new Date(`${since}T09:00:00Z`), ...over });

  it("puts what stops work first, then what has a date this week, then the oldest", () => {
    const rows = [
      r("ישן", "2026-10-01"),
      r("חוסם", "2026-10-21", { blocking: true }),
      r("בעוד שבועיים", "2026-09-01", { deadline: new Date("2026-11-05T00:00:00Z") }),
      r("מחר", "2026-10-20", { deadline: new Date("2026-10-23T00:00:00Z") }),
      r("היום", "2026-10-21", { deadline: new Date("2026-10-22T00:00:00Z") }),
      r("חדש", "2026-10-21"),
    ];
    const { today, rest } = rankApprovals(rows, now);
    expect(today.map((x) => x.title)).toEqual(["חוסם", "היום", "מחר", "בעוד שבועיים", "ישן"]);
    expect(rest.map((x) => x.title)).toEqual(["חדש"]);
  });

  it("counts an overdue date as near", () => {
    expect(urgency(r("x", "2026-10-01", { deadline: new Date("2026-10-01T00:00:00Z") }), now)).toBe(1);
    expect(urgency(r("x", "2026-10-01", { deadline: new Date("2026-12-01T00:00:00Z") }), now)).toBe(2);
  });
});
