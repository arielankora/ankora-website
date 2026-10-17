import { describe, expect, it } from "vitest";
import { blockingChecks, completeness, processGaps, readSteps, type ProcessStep } from "@/lib/process-rules";

// Org brain, phase 1 (claude/org-brain-spec-2026-10-12.md, 3.8, 3.9, 7.2):
// the checks a procedure faces before a manager can approve it, and the
// nine fields that make a process complete.

const step = (over: Partial<ProcessStep>): ProcessStep => ({
  title: "שלב",
  mode: "MANUAL",
  offsetBusinessDays: null,
  actionTags: [],
  systemIds: [],
  output: null,
  verification: null,
  requiresApproval: false,
  amountMaxMinor: null,
  currency: null,
  channel: null,
  ...over,
});

describe("readSteps", () => {
  it("keeps what it understands and drops the rest", () => {
    expect(
      readSteps([
        { title: " מעלים ל-Doka ", mode: "WEIRD", actionTags: ["INVOICE", "HACK", "INVOICE"], offsetBusinessDays: -2 },
        { title: "" },
        "x",
        { title: "תשלום", mode: "AUTOMATED", offsetBusinessDays: 999, requiresApproval: "yes" },
      ])
    ).toEqual([
      step({ title: "מעלים ל-Doka", actionTags: ["INVOICE"], offsetBusinessDays: -2 }),
      step({ title: "תשלום", mode: "AUTOMATED" }),
    ]);
    expect(readSteps(null)).toEqual([]);
  });
});

describe("blockingChecks", () => {
  it("R1: what the SOP book keeps for people is never automated, and when Claude prepares it a person approves", () => {
    expect(blockingChecks({ steps: [step({ mode: "AUTOMATED", actionTags: ["PAYMENT"], verification: "x" })] }, []).map((c) => c.code)).toEqual(["R1"]);
    expect(blockingChecks({ steps: [step({ mode: "ASSISTED", actionTags: ["BANK_SIGNATURE"] })] }, []).map((c) => c.code)).toEqual(["R1"]);
    expect(blockingChecks({ steps: [step({ mode: "ASSISTED", actionTags: ["BANK_SIGNATURE"], requiresApproval: true })] }, [])).toEqual([]);
    expect(blockingChecks({ steps: [step({ mode: "MANUAL", actionTags: ["CONTRACT"] })] }, [])).toEqual([]);
  });

  it("R1: a message to the client is checked by a person, so never automated", () => {
    expect(blockingChecks({ steps: [step({ mode: "AUTOMATED", actionTags: ["CLIENT_MESSAGE"], verification: "x" })] }, []).map((c) => c.code)).toEqual(["R1"]);
    expect(blockingChecks({ steps: [step({ mode: "ASSISTED", actionTags: ["CLIENT_MESSAGE"] })] }, [])).toEqual([]);
  });

  it("R3: an automated step says how a person makes sure it happened", () => {
    expect(blockingChecks({ steps: [step({ mode: "AUTOMATED" })] }, []).map((c) => c.code)).toEqual(["R3"]);
    expect(blockingChecks({ steps: [step({ mode: "AUTOMATED", verification: "בודקים בדוח" })] }, [])).toEqual([]);
  });

  it("R2: moving money under the client's approval rules needs an approval step", () => {
    const pay = step({ actionTags: ["PAYMENT"] });
    expect(blockingChecks({ steps: [pay] }, [])).toEqual([]);
    const r = blockingChecks({ steps: [pay] }, ["תוכנה עד 3,000$"]);
    expect(r.map((c) => c.code)).toEqual(["R2"]);
    expect(r[0].message).toContain("תוכנה עד 3,000$");
    expect(blockingChecks({ steps: [pay, step({ title: "אורן מאשר", requiresApproval: true })] }, ["x"])).toEqual([]);
  });

  it("R4: no secret in a procedure", () => {
    expect(blockingChecks({ steps: [step({ title: "נכנסים עם password: hunter2" })] }, []).map((c) => c.code)).toEqual(["R4"]);
    expect(blockingChecks({ steps: [step({})], highlights: "api key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789" }, []).map((c) => c.code)).toEqual(["R4"]);
  });
});

describe("completeness", () => {
  const empty = {
    ownerId: null,
    backupOwnerId: null,
    triggerKinds: [] as ("SCHEDULED" | "EVENT")[],
    triggerText: null,
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

  it("counts Oren's nine fields; a process not triggered by a date has no next date to miss", () => {
    expect(completeness(empty)).toMatchObject({ score: 1, missing: ["owner", "trigger", "sla", "systems", "permissions", "approvals", "external", "exceptions"] });
    const full = {
      ...empty,
      ownerId: "u",
      triggerKinds: ["SCHEDULED" as const],
      triggerText: "10 ו-25",
      slaBusinessDays: 2,
      requiredSystemIds: ["s"],
      approverText: "מורשה חתימה",
      approvalText: "אין",
      externalPartyText: "Nextage",
      exceptionPlaybook: "x",
      nextDate: new Date(),
    };
    expect(completeness(full)).toMatchObject({ score: 9, missing: [] });
    expect(completeness({ ...full, nextDate: null }).missing).toEqual(["next"]);
    expect(completeness({ ...full, systemsWithoutAccess: ["s"] }).missing).toEqual(["permissions"]);
  });

  it("names the gaps: missing fields, systems without access, nobody to back up", () => {
    const gaps = processGaps({ ...empty, ownerId: "u", requiredSystemIds: ["s"], systemsWithoutAccess: ["s"] }, () => "Mercury");
    expect(gaps).toContain("חסר: טריגר");
    expect(gaps).toContain("אין לנו גישה ל: Mercury");
    expect(gaps).toContain("אין מחליף: הידע אצל אדם אחד");
    expect(gaps.some((g) => g.includes("הרשאות"))).toBe(false);
  });
});
