import { describe, expect, it } from "vitest";
import { readinessLine, readinessOf, type ReadinessProcessInput } from "@/lib/handover-readiness";

// Spec 3.9 and 11: the four things (22.10.2026: a backup is not one) true of a process before the person who
// does it today can leave, and what is still missing.

const base: ReadinessProcessInput = {
  id: "p",
  code: "P1",
  title: "שכר",
  status: "ACTIVE",
  transitionStatus: "WITH_ANKORA",
  ownerId: "h",
  executor: null,
  hasApprovedProcedure: true,
  completeness: 9,
  systems: [{ id: "s1", name: "Doka", accessStatus: "HAS_ACCESS", permission: null }],
};

describe("handover readiness", () => {
  it("a process with all four is ready", () => {
    const r = readinessOf([base]);
    expect(r).toMatchObject({ ready: 1, total: 1, systemsWithoutAccess: [] });
    expect(readinessLine(r)).toBe("התהליך מוכן: אפשר להעביר אותו אלינו.");
  });

  it("says what is missing, least ready first, and each system once", () => {
    const mercury = { id: "s2", name: "Mercury", accessStatus: "NO_ACCESS", permission: "אישור תשלומים" };
    const r = readinessOf([
      base,
      { ...base, id: "q", code: "P2", title: "ספקים", transitionStatus: "IN_HANDOVER", executor: "גיא", hasApprovedProcedure: false, completeness: 5, systems: [mercury] },
      { ...base, id: "r", code: "P3", title: "קבלנים", systems: [mercury] },
      { ...base, id: "x", code: "P4", title: "IT", transitionStatus: "NOT_PLANNED" },
      { ...base, id: "y", code: "P5", title: "ישן", status: "RETIRED", transitionStatus: "IN_HANDOVER" },
    ]);
    expect(r.total).toBe(3);
    expect(r.ready).toBe(1);
    expect(r.processes[0].code).toBe("P2");
    expect(r.processes[0].missing).toEqual([
      "אין נוהל מאושר: מנהל מאשר את הטיוטה במסך התהליכים.",
      "אין לנו גישה ל: Mercury (אישור תשלומים).",
      "עוד לא אצלנו: היום מבצע גיא.",
      "התיעוד 5 מתוך 9.",
    ]);
    expect(r.systemsWithoutAccess.map((s) => s.name)).toEqual(["Mercury"]);
    expect(r.notPlanned).toEqual(["P4 IT"]);
    expect(readinessLine(r)).toBe("1 מתוך 3 תהליכים מוכנים, ומערכת אחת בלי גישה.");
  });

  it("nothing planned yet", () => {
    expect(readinessLine(readinessOf([]))).toBe("אין עדיין תהליכים שמתוכננים לעבור אלינו.");
  });
});

describe("no backup", () => {
  it("a process without a backup is ready when the four are true", () => {
    expect(readinessOf([base]).processes[0].missing).toEqual([]);
  });
});
