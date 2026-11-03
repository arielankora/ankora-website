import { describe, expect, it } from "vitest";
import { CONTINUOUS_NO_CHECK_BLOCKER, readinessLabel, runBlocker, runBlockers, runReadiness, SCHEDULED_NO_DATE_BLOCKER } from "@/lib/process-readiness";
import { completeness, documentation, documentationLine, processGaps, readNotApplicable, type CompletenessInput } from "@/lib/process-rules";

// 25.10.2026 (Ariel: "there is always something missing"): whether a
// process runs is one question, and how well it is written down another.

const runs = { status: "ACTIVE", ownerId: "h", triggerKinds: ["SCHEDULED"], triggerText: "ב-10 וב-25", nextDate: new Date("2026-11-10") };

describe("run readiness", () => {
  it("runs with an owner, a trigger, an approved procedure, and a date when it runs by one", () => {
    expect(runReadiness(runs)).toEqual({ ready: true, blocker: null });
    expect(readinessLabel(runReadiness(runs))).toBe("רץ");
    expect(runReadiness({ ...runs, triggerKinds: ["EVENT"], nextDate: null }).ready).toBe(true);
  });

  it("gives the one reason, the first to fix", () => {
    expect(runBlocker({ ...runs, ownerId: null, status: "DRAFT" })).toBe("לא ירוץ: אין אחראי");
    expect(runBlocker({ ...runs, triggerText: " " })).toBe("לא ירוץ: לא כתוב מה מפעיל אותו");
    expect(runBlocker({ ...runs, triggerKinds: [] })).toBe("לא ירוץ: לא כתוב מה מפעיל אותו");
    expect(runBlocker({ ...runs, status: "DRAFT" })).toBe("לא ירוץ: אין נוהל מאושר");
    expect(runBlocker({ ...runs, nextDate: null })).toBe(SCHEDULED_NO_DATE_BLOCKER);
    expect(runBlocker({ ...runs, status: "PAUSED" })).toBe("לא ירוץ: התהליך מושהה");
    expect(runBlocker({ ...runs, status: "RETIRED" })).toBe("לא ירוץ: התהליך בוטל");
    expect(readinessLabel(runReadiness({ ...runs, status: "DRAFT" }))).toBe("לא ירוץ: אין נוהל מאושר");
  });

  // 2.11.2026: P7 of Ankora's own file, in force with no trigger written and
  // no date, read as missing one thing while "אישורים" listed two.
  it("lists every reason, the first to fix leading", () => {
    expect(runBlockers(runs)).toEqual([]);
    expect(runBlockers({ ...runs, triggerText: null, nextDate: null })).toEqual(["לא ירוץ: לא כתוב מה מפעיל אותו", SCHEDULED_NO_DATE_BLOCKER]);
    expect(runBlockers({ ...runs, ownerId: null, status: "DRAFT", triggerKinds: [] })).toEqual(["לא ירוץ: אין אחראי", "לא ירוץ: לא כתוב מה מפעיל אותו", "לא ירוץ: אין נוהל מאושר"]);
    // A draft's missing date waits for its approval, as before.
    expect(runBlockers({ ...runs, status: "DRAFT", nextDate: null })).toEqual(["לא ירוץ: אין נוהל מאושר"]);
    // Retired or paused: that reason alone.
    expect(runBlockers({ ...runs, status: "PAUSED", ownerId: null })).toEqual(["לא ירוץ: התהליך מושהה"]);
    // The one reason the screen shows is the first of them.
    expect(runBlocker({ ...runs, triggerText: null, nextDate: null })).toBe(runBlockers({ ...runs, triggerText: null, nextDate: null })[0]);
  });

  // 3.11.2026: P7 of Grantor, ongoing only, in force, no check: in nobody's
  // routine, and it read "רץ".
  it("an ongoing process with no check does not run", () => {
    const ongoing = { ...runs, triggerKinds: ["CONTINUOUS"], triggerText: "כל יום עבודה ב-9:00", nextDate: null };
    expect(runBlockers({ ...ongoing, checkEveryDays: null })).toEqual([CONTINUOUS_NO_CHECK_BLOCKER]);
    expect(runBlockers({ ...ongoing, checkEveryDays: 1 })).toEqual([]);
    // A caller that did not read the field does not judge it.
    expect(runBlockers(ongoing)).toEqual([]);
    // Ongoing beside another trigger opens runs: not this reason.
    expect(runBlockers({ ...ongoing, triggerKinds: ["CONTINUOUS", "EVENT"], checkEveryDays: null })).toEqual([]);
    // A draft waits for its approval first.
    expect(runBlockers({ ...ongoing, status: "DRAFT", checkEveryDays: null })).toEqual(["לא ירוץ: אין נוהל מאושר"]);
  });
});

const base: CompletenessInput = {
  ownerId: "h",
  triggerKinds: ["EVENT"],
  triggerText: "עובד חדש",
  slaText: null,
  slaBusinessDays: null,
  requiredSystemIds: [],
  systemsWithoutAccess: [],
  approverText: null,
  approverContactId: null,
  approvalPolicyIds: [],
  approvalText: null,
  externalPartyContactIds: [],
  externalPartyText: null,
  exceptionPlaybook: null,
  nextDate: null,
};

describe("documentation", () => {
  it("counts only the documentation fields, and never what makes it run", () => {
    expect(documentation(base)).toMatchObject({ score: 0, of: 6, missing: ["sla", "systems", "permissions", "approvals", "external", "exceptions"] });
    expect(documentationLine(documentation(base))).toBe("תיעוד 0 מתוך 6");
  });

  it("a named approver is enough, without an approval rule", () => {
    expect(documentation({ ...base, approverText: "גיא, ואחריו יונתן" }).missing).not.toContain("approvals");
    expect(documentation({ ...base, approverContactId: "c1" }).missing).not.toContain("approvals");
    expect(documentation({ ...base, approvalText: "מעל 5,000 ש\"ח" }).missing).toContain("approvals");
  });

  it("a party named in the process counts as the outside party", () => {
    expect(documentation({ ...base, mentionedExternal: true }).missing).not.toContain("external");
  });

  it("fields marked not relevant are left out, and systems takes permissions with it", () => {
    const d = documentation({ ...base, notApplicableFields: ["systems", "external", "sla"] });
    expect(d).toMatchObject({ score: 0, of: 2, missing: ["approvals", "exceptions"], notApplicable: ["systems", "external", "sla"] });
    const full = documentation({ ...base, notApplicableFields: ["systems", "external", "sla"], approverText: "אורן", exceptionPlaybook: "פונים לאורן" });
    expect(documentationLine(full)).toBe("תיעוד מלא");
    expect(completeness({ ...base, notApplicableFields: ["systems"] }).of).toBe(7);
  });

  it("a field not relevant is never a gap", () => {
    expect(processGaps({ ...base, notApplicableFields: ["external", "exceptions"] }, () => "x")).not.toContain("חסר: גורם חיצוני");
    expect(processGaps({ ...base, notApplicableFields: ["systems"], requiredSystemIds: [], systemsWithoutAccess: ["s"] }, () => "Mercury").join(" ")).not.toContain("Mercury");
  });

  it("reads only the fields that may be marked, once each", () => {
    expect(readNotApplicable(["sla", "owner", "sla", 3, "next", "external"])).toEqual(["sla", "external"]);
    expect(readNotApplicable(null)).toEqual([]);
  });
});
