import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OFFBOARDING_STEPS,
  ONBOARDING_STEPS,
  offboardingDescription,
  offboardingPrompt,
  onboardingDescription,
  onboardingPrompt,
} from "@/lib/employee-lifecycle-prompts";

/// Ankora staff are "ספק פנימי אנקורה" in the lifecycle and "איש צוות"
/// elsewhere, never "עובד". The word may still appear as a verb ("works")
/// or inside "עובדה" (a fact); those are removed before the check.
function withoutAllowedUses(text: string): string {
  return text
    .replace(/עובד(ה|ות)/g, "")
    .replace(/הספק הפנימי עובד עם לקוחות/g, "");
}

function expectNoEmployeeWord(text: string) {
  expect(withoutAllowedUses(text)).not.toContain("עובד");
}

describe("staff terminology in the employee lifecycle", () => {
  const onboarding = onboardingPrompt({
    employeeName: "נועה לוי",
    employeeEmail: "noa@ankora.co.il",
    userId: "u1",
    taskId: "t1",
    code: "AB12CD",
  });
  const offboarding = offboardingPrompt({
    employeeName: "נועה לוי",
    userId: "u1",
    taskId: "t2",
    code: "EF34GH",
    deadline: "20.10.2026",
    adminUrl: "https://www.ankora.co.il/app/users/u1",
  });

  it("prompts say ספק פנימי, not עובד", () => {
    expectNoEmployeeWord(onboarding);
    expectNoEmployeeWord(offboarding);
    expect(onboarding).toContain("הספק הפנימי");
    expect(offboarding).toContain("הספק הפנימי");
  });

  it("descriptions and role label say ספק פנימי אנקורה", () => {
    const on = onboardingDescription({
      employeeName: "נועה לוי",
      role: "ANKORA_EMPLOYEE",
      workEmail: "noa@ankora.co.il",
      hasPersonalEmail: false,
      prompt: onboarding,
    });
    const off = offboardingDescription({
      employeeName: "נועה לוי",
      role: "ANKORA_EMPLOYEE",
      workEmail: "noa@ankora.co.il",
      personalEmail: null,
      deadline: "20.10.2026",
      userPageUrl: "https://www.ankora.co.il/app/users/u1",
      clientNames: [],
      prompt: offboarding,
    });
    expectNoEmployeeWord(on);
    expectNoEmployeeWord(off);
    expect(on).toContain("ספק פנימי אנקורה");
    expect(off).toContain("ספק פנימי אנקורה");
  });

  it("step titles never say עובד", () => {
    for (const step of [...ONBOARDING_STEPS, ...OFFBOARDING_STEPS]) expectNoEmployeeWord(step);
  });

  it("lifecycle task titles say ספק פנימי", () => {
    const source = readFileSync(join(process.cwd(), "lib/app-domain/employee-lifecycle.ts"), "utf8");
    const titles = [...source.matchAll(/title: `([^`]*)`/g)].map((m) => m[1]);
    expect(titles).toContain("קליטת ספק פנימי: ${subject.name}");
    expect(titles).toContain("עזיבת ספק פנימי: ${subject.name}");
    for (const title of titles) expectNoEmployeeWord(title);
  });

  it("the filter keeps a stray עובד visible", () => {
    expect(withoutAllowedUses("קליטת עובד: נועה")).toContain("עובד");
    expect(withoutAllowedUses("זו עובדה ידועה")).not.toContain("עובד");
  });
});
