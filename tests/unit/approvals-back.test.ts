import { describe, expect, it } from "vitest";
import { approvalsBack, approvalsBackParam, withApprovalsBack } from "@/lib/approvals";
import { hashTargetId } from "@/lib/hash-target";
import { planPreview, procedurePreview, rulePreview, stepLine } from "@/lib/approvals-preview";
import type { ProcessStep } from "@/lib/process-rules";

// 22.10.2026, Ariel from a phone: a procedure on "אישורים" opened the
// client's page at the top, and its way back was "לקוחות".

describe("withApprovalsBack", () => {
  it("adds the view before the hash, which stays last", () => {
    expect(withApprovalsBack("/app/clients/c1?tab=file#item-p1", "procedure", "c1")).toBe(
      "/app/clients/c1?tab=file&fromApprovals=tab%3Dprocedure%26clientId%3Dc1#item-p1"
    );
  });
  it("starts a query when there is none, and says all for the default view", () => {
    expect(withApprovalsBack("/app/tasks/t1", "all", null)).toBe("/app/tasks/t1?fromApprovals=all");
  });
  it("leaves links inside approvals and outside the app alone", () => {
    expect(withApprovalsBack("/app/approvals?tab=knowledge", "all", null)).toBe("/app/approvals?tab=knowledge");
    expect(withApprovalsBack("https://example.com/x", "rule", null)).toBe("https://example.com/x");
  });
});

describe("approvalsBack", () => {
  it("returns to the same tab and client, named", () => {
    expect(approvalsBack("tab=procedure&clientId=c1")).toEqual({
      href: "/app/approvals?tab=procedure&clientId=c1",
      label: "אישורים · נהלים",
      param: "fromApprovals=tab%3Dprocedure%26clientId%3Dc1",
    });
  });
  it("all is the plain screen", () => {
    expect(approvalsBack("all")).toMatchObject({ href: "/app/approvals", label: "אישורים" });
  });
  it("is null without the parameter, so other ways back stay as they were", () => {
    expect(approvalsBack(undefined)).toBeNull();
    expect(approvalsBack("")).toBeNull();
    expect(approvalsBackParam(undefined)).toBe("");
  });
  it("keeps only its own keys and never leaves /app/approvals", () => {
    const back = approvalsBack("tab=nonsense&next=https://evil.example&clientId=c2");
    expect(back?.href).toBe("/app/approvals?clientId=c2");
    expect(back?.param).not.toContain("evil");
  });
  it("round trips through a link", () => {
    const href = withApprovalsBack("/app/tasks/t1", "task", "c9");
    const value = new URL(href, "https://x.test").searchParams.get("fromApprovals");
    expect(approvalsBack(value)?.href).toBe("/app/approvals?tab=task&clientId=c9");
  });
});

describe("hashTargetId", () => {
  it("reads a plain id", () => {
    expect(hashTargetId("#item-cmvgjgstn000did08x0kw64lx")).toBe("item-cmvgjgstn000did08x0kw64lx");
    expect(hashTargetId("#portal-summary")).toBe("portal-summary");
  });
  it("refuses anything else", () => {
    expect(hashTargetId("")).toBeNull();
    expect(hashTargetId("#")).toBeNull();
    expect(hashTargetId("#a b")).toBeNull();
    expect(hashTargetId("#%E0%A4%A")).toBeNull();
    expect(hashTargetId("#1abc")).toBeNull();
  });
});

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

describe("procedurePreview", () => {
  it("lists the steps with their systems, and what is held back", () => {
    const p = procedurePreview(
      { steps: [step({ title: "הורדת קבלות", systemIds: ["s1"], verification: "בודקים בתיקייה" }), step({ title: "שליחה ל-Nextage", requiresApproval: true })], highlights: "חודש סגור", outputs: null },
      { s1: "Gmail" },
      [
        { message: "שלב תשלום בלי אישור.", severity: "BLOCK" },
        { message: "שליחה בערוץ אחר.", severity: "EXCEPTION", excepted: true },
        { message: "חשבונית לישות אחרת.", severity: "EXCEPTION", excepted: false },
      ]
    );
    expect(p.toggle).toBe("הצגת הנוהל");
    expect(p.sections[0].lines[0]).toContain("1. הורדת קבלות");
    expect(p.sections[0].lines[0]).toContain("Gmail");
    expect(p.sections[0].lines[0]).toContain("אימות: בודקים בתיקייה");
    expect(p.sections[0].lines[1]).toContain("דורש אישור");
    expect(p.sections.map((s) => s.heading)).toEqual(["שלבים", "דגשים", "בדיקות עם חריגה מאושרת"]);
    expect(p.problems).toHaveLength(2);
    expect(p.problems[1]).toContain("חריגה מאושרת");
  });
  it("names a removed system instead of its id", () => {
    expect(stepLine(step({ systemIds: ["gone"] }), 0, {})).toContain("מערכת שהוסרה");
  });
});

describe("rule and plan previews", () => {
  it("a rule shows its interim rule and why", () => {
    const p = rulePreview({ statement: "כל מייל עובר אצל יוסי", interimStatement: "לא שולחים בלי אישור כתוב", rationale: "בשם החברה" });
    expect(p.sections.map((s) => s.heading)).toEqual(["הכלל", "עד שיאושר", "למה"]);
  });
  it("a plan shows its body and its proposed steps", () => {
    const p = planPreview({ body: "קודם בודקים", steps: ["א", "ב"] });
    expect(p.sections[1].lines).toEqual(["1. א", "2. ב"]);
  });
});
