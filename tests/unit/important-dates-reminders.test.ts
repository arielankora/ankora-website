import { describe, expect, it } from "vitest";
import {
  buildReminderIdempotencyKey,
  buildAutoTaskOccurrenceKey,
  buildInAppReminderMessage,
  buildEmailReminderSubject,
  DEFAULT_REMINDER_OFFSETS_BY_CATEGORY,
  IMPORTANT_DATE_TYPE_EXAMPLES,
} from "@/lib/app-domain/important-dates-reminders";

// Phase 10 ("מועדים חשובים"). Zero Prisma import - genuinely runs here.

describe("buildReminderIdempotencyKey()", () => {
  it("produces a stable, deterministic key for the same inputs", () => {
    const params = { importantDateId: "d1", reminderRuleId: "r1", occurrenceYear: 2026, channel: "EMAIL" as const };
    expect(buildReminderIdempotencyKey(params)).toBe(buildReminderIdempotencyKey(params));
  });

  it("differs when any single axis changes - date, rule, year, or channel", () => {
    const base = { importantDateId: "d1", reminderRuleId: "r1", occurrenceYear: 2026, channel: "EMAIL" as const };
    const variants = [
      buildReminderIdempotencyKey({ ...base, importantDateId: "d2" }),
      buildReminderIdempotencyKey({ ...base, reminderRuleId: "r2" }),
      buildReminderIdempotencyKey({ ...base, occurrenceYear: 2027 }),
      buildReminderIdempotencyKey({ ...base, channel: "IN_APP" }),
    ];
    const baseKey = buildReminderIdempotencyKey(base);
    for (const v of variants) expect(v).not.toBe(baseKey);
    // And all four variants are themselves distinct from each other.
    expect(new Set(variants).size).toBe(variants.length);
  });
});

describe("buildAutoTaskOccurrenceKey()", () => {
  it("is stable for the same year and differs across years", () => {
    expect(buildAutoTaskOccurrenceKey(2026)).toBe(buildAutoTaskOccurrenceKey(2026));
    expect(buildAutoTaskOccurrenceKey(2026)).not.toBe(buildAutoTaskOccurrenceKey(2027));
  });
});

describe("message templates", () => {
  const input = { clientName: "חברת דוגמה", dateTitle: "יום הולדת", occurrenceDate: "28/02/2026", daysBefore: 7 };

  it("renders a relative day phrase for 0/1/N days before", () => {
    expect(buildInAppReminderMessage({ ...input, daysBefore: 0 })).toContain("היום");
    expect(buildInAppReminderMessage({ ...input, daysBefore: 1 })).toContain("מחר");
    expect(buildInAppReminderMessage({ ...input, daysBefore: 7 })).toContain("בעוד 7 ימים");
  });

  it("includes the client name and date title in the email subject", () => {
    const subject = buildEmailReminderSubject(input);
    expect(subject).toContain(input.clientName);
    expect(subject).toContain(input.dateTitle);
  });
});

describe("DEFAULT_REMINDER_OFFSETS_BY_CATEGORY", () => {
  it("covers all six ImportantDateCategory values with at least one offset each", () => {
    const categories: (keyof typeof DEFAULT_REMINDER_OFFSETS_BY_CATEGORY)[] = [
      "PEOPLE_FAMILY",
      "DOCUMENTS_AUTHORITIES",
      "BUSINESS_FINANCE",
      "VEHICLE_PROPERTY",
      "HEALTH_TRAVEL",
      "GENERAL",
    ];
    for (const cat of categories) {
      expect(DEFAULT_REMINDER_OFFSETS_BY_CATEGORY[cat].length).toBeGreaterThan(0);
    }
  });

  it("gives document/authority renewals the longest lead time (slow renewal processes)", () => {
    const docsMax = Math.max(...DEFAULT_REMINDER_OFFSETS_BY_CATEGORY.DOCUMENTS_AUTHORITIES);
    const familyMax = Math.max(...DEFAULT_REMINDER_OFFSETS_BY_CATEGORY.PEOPLE_FAMILY);
    expect(docsMax).toBeGreaterThan(familyMax);
  });
});

describe("IMPORTANT_DATE_TYPE_EXAMPLES", () => {
  it("provides at least one example type per category", () => {
    for (const key of Object.keys(IMPORTANT_DATE_TYPE_EXAMPLES) as (keyof typeof IMPORTANT_DATE_TYPE_EXAMPLES)[]) {
      expect(IMPORTANT_DATE_TYPE_EXAMPLES[key].length).toBeGreaterThan(0);
    }
  });
});
