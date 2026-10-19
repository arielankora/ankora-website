import { describe, expect, it } from "vitest";
import { FactPayload, firefliesLink, normalizeForMatch, payloadText, proposalHeadline, secondsOf, taskBlocker, taskFromProposal, TaskPayload, missingRequired, proposalDetails } from "@/lib/knowledge-proposals";

describe("knowledge proposals, pure parts", () => {
  it("opens a recording at the minute", () => {
    expect(secondsOf("08:13")).toBe(493);
    expect(secondsOf("1:02:03")).toBe(3723);
    expect(secondsOf("soon")).toBeNull();
    expect(firefliesLink("abc123", "08:13")).toBe("https://app.fireflies.ai/view/abc123?t=493");
    expect(firefliesLink("abc123")).toBe("https://app.fireflies.ai/view/abc123");
  });

  it("matches the same fact through case, spacing and punctuation", () => {
    expect(normalizeForMatch("WhatsApp,  אחר כך Slack!")).toBe(normalizeForMatch("whatsapp אחר כך slack"));
    expect(normalizeForMatch("Slack")).not.toBe(normalizeForMatch("WhatsApp"));
  });

  it("collects every string a payload carries, for the secret scan", () => {
    expect(payloadText({ name: "שני", emails: ["a@b.co"], nested: { context: "x" }, isPrimary: true })).toBe("שני\na@b.co\nx");
  });

  it("names a proposal by its main line", () => {
    expect(proposalHeadline("CONTACT", { name: "שני", role: "VP Finance" })).toBe("שני, VP Finance");
    expect(proposalHeadline("SYSTEM", { systemName: "Mercury" })).toBe("Mercury");
  });

  it("refuses a fact without words or with an unknown kind", () => {
    expect(FactPayload.safeParse({ kind: "NOTE", body: "" }).success).toBe(false);
    expect(FactPayload.safeParse({ kind: "GOSSIP", body: "x" }).success).toBe(false);
    expect(FactPayload.safeParse({ kind: "TEMPORARY", body: "x", validUntil: "2026-12-01" }).success).toBe(true);
    expect(FactPayload.safeParse({ kind: "TEMPORARY", body: "x", validUntil: "1.12.2026" }).success).toBe(false);
  });
});

describe("the new targets on the review card", () => {
  it("a process shows its trigger and steps, an entity its identifiers, a long text in full", async () => {
    const { proposalDetails, proposalHeadline, PAYLOADS } = await import("@/lib/knowledge-proposals");
    const proc = { title: "תשלומי ספקים", triggerText: "ב-10 וב-25", steps: [{ title: "מעלים" }, { title: "חותמים", requiresApproval: true }] };
    expect(PAYLOADS.PROCESS.safeParse(proc).success).toBe(true);
    expect(proposalHeadline("PROCESS", proc)).toBe("תשלומי ספקים");
    expect(proposalDetails("PROCESS", proc)).toEqual(["מה מפעיל: ב-10 וב-25", "1. מעלים", "2. חותמים (דורש אישור)"]);
    expect(proposalDetails("ENTITY", { name: "NUX.AI Ltd", country: "IL", parentName: "NUX Inc" })).toEqual(["IL", "בת של NUX Inc"]);
    const long = "א".repeat(200);
    expect(proposalHeadline("NARRATIVE", { kind: "OVERVIEW", body: long })).toHaveLength(160);
    expect(proposalDetails("NARRATIVE", { kind: "OVERVIEW", body: long })).toEqual([long]);
    expect(PAYLOADS.DOMAIN.safeParse({ domain: "nux.ai", kind: "VENDOR" }).success).toBe(false);
  });
});

describe("what blocks approval (spec 5.2)", () => {
  it("a cited code not in the register, and an item missing what makes it whole, block; a process's procedure only warns", async () => {
    const { proposalProblems, bulkApproveBlocker } = await import("@/lib/knowledge-proposals");
    const r17 = proposalProblems("NARRATIVE", { kind: "OVERVIEW", body: "חברה [S1 02:00] עם שתי ישויות [S9]" }, ["S1"]);
    expect(r17).toEqual([expect.objectContaining({ code: "R17", block: true })]);
    expect(r17[0].message).toContain("S9");
    expect(proposalProblems("FACT", { kind: "TEMPORARY", body: "Anthropic בכרטיס הפרטי" }, [])[0]).toMatchObject({ code: "SHAPE", block: true });
    expect(proposalProblems("FACT", { kind: "TEMPORARY", body: "x", validUntilEvent: "עד הצירוף" }, [])).toEqual([]);
    expect(proposalProblems("POLICY", { kind: "THRESHOLD", title: "תוכנה", statement: "עד 3,000$" }, [])[0]).toMatchObject({ block: true });
    const proc = proposalProblems("PROCESS", { title: "תשלום", steps: [{ title: "משלמים", mode: "AUTOMATED", actionTags: ["PAYMENT"] }] }, []);
    expect(proc.map((f) => [f.code, !!f.block])).toEqual([
      ["R1", false],
      ["R3", false],
    ]);
    expect(bulkApproveBlocker({ action: "CREATE", flags: r17, payload: {} })).toContain("חוסם");
  });
});

describe("decision 1's measure", () => {
  it("says the share edited, the end of the first month, and then where it stands", async () => {
    const { qualityLine } = await import("@/lib/knowledge-proposals");
    const now = new Date("2026-11-30T10:00:00Z");
    expect(qualityLine({ approved: 0, editedBeforeApproval: 0, rejected: 0, firstDecidedAt: null }, now).tone).toBe("neutral");
    const early = qualityLine({ approved: 40, editedBeforeApproval: 3, rejected: 5, firstDecidedAt: new Date("2026-11-15T00:00:00Z") }, now);
    expect(early.text).toContain("40 אושרו, 3 מהן אחרי עריכה (7.5%), 5 נדחו");
    expect(early.text).toContain("החודש הראשון נגמר ב-15.12.2026");
    const after = new Date("2026-10-17T00:00:00Z");
    expect(qualityLine({ approved: 100, editedBeforeApproval: 5, rejected: 2, firstDecidedAt: after }, now).tone).toBe("good");
    expect(qualityLine({ approved: 100, editedBeforeApproval: 15, rejected: 2, firstDecidedAt: after }, now).tone).toBe("warn");
  });
});

describe("a proposal that is a task", () => {
  it("starts the task from the proposal: its line, why, the quote, the source and the moment", () => {
    const t = taskFromProposal({
      target: "FACT",
      payload: { kind: "NOTE", body: "לשלוח לדנה את החוזה המעודכן", doNotDisclose: "המחיר החדש" },
      reason: "אורן ביקש בסוף הפגישה",
      quote: "תשלחו לה עד יום חמישי",
      source: { code: "S3", title: "NUX weekly" },
      link: "https://app.fireflies.ai/view/ff?t=60",
    });
    expect(t.title).toBe("לשלוח לדנה את החוזה המעודכן");
    expect(t.description.split("\n\n")).toEqual([
      "למה: אורן ביקש בסוף הפגישה",
      '"תשלחו לה עד יום חמישי"',
      "לא לספר: המחיר החדש",
      "מקור: S3 NUX weekly",
      "ברגע בשיחה: https://app.fireflies.ai/view/ff?t=60",
      "נפתחה מהצעה של Claude בממתין לאישור.",
    ]);
  });

  it("cuts a long line for the title and keeps the whole of it in the description", () => {
    const body = "א".repeat(260);
    const t = taskFromProposal({ target: "FACT", payload: { body }, reason: null, quote: null, source: null, link: null });
    expect(t.title).toHaveLength(200);
    expect(t.title.endsWith("...")).toBe(true);
    expect(t.description.startsWith(body)).toBe(true);
  });

  it("keeps what only some may read as a proposal", () => {
    expect(taskBlocker({ payload: { body: "x" } })).toBeNull();
    expect(taskBlocker({ payload: { sensitivity: "SENSITIVE" } })).toContain("רגיש");
    expect(taskBlocker({ payload: { audience: "RESTRICTED" } })).toContain("חלק מהצוות");
    expect(taskBlocker({ payload: { audience: "ALL_STAFF" } })).toBeNull();
  });
});

describe("a task proposed by Claude", () => {
  it("is an action with a reason, and no knowledge fields", () => {
    const parsed = TaskPayload.parse({ title: "לשלוח לדנה את החוזה", dueDate: "2026-10-22", assigneeName: "הדס", knowledgeStatus: "CONFIRMED", sensitivity: "SENSITIVE" });
    expect(parsed).toEqual({ title: "לשלוח לדנה את החוזה", dueDate: "2026-10-22", assigneeName: "הדס" });
    expect(TaskPayload.safeParse({ title: "x", dueDate: "22.10" }).success).toBe(false);
    expect(missingRequired("TASK", { title: "x" }, "אורן ביקש")).toBeNull();
    expect(missingRequired("TASK", { title: "x" }, "")).toContain("סיבה");
  });

  it("reads as what to do, by when and by whom", () => {
    expect(proposalHeadline("TASK", { title: "לשלוח לדנה את החוזה" })).toBe("לשלוח לדנה את החוזה");
    expect(proposalDetails("TASK", { title: "x", description: "הגרסה מ-12.10", dueDate: "2026-10-22", assigneeName: "הדס", priority: "HIGH" })).toEqual([
      "הגרסה מ-12.10",
      "תאריך יעד: 2026-10-22",
      "אחראי: הדס",
      "עדיפות: גבוהה",
    ]);
  });

  it("is not turned into a task again, and its description leads the task", () => {
    expect(taskBlocker({ target: "TASK", payload: { title: "x" } })).toContain("כבר משימה");
    const t = taskFromProposal({ target: "TASK", payload: { title: "לשלוח חוזה", description: "הגרסה מ-12.10" }, reason: "אורן ביקש", quote: null, source: null, link: null });
    expect(t.description.split("\n\n").slice(0, 2)).toEqual(["הגרסה מ-12.10", "למה: אורן ביקש"]);
  });
});

describe("what a proposal names in the file", () => {
  it("says it on the card, linked when approved", async () => {
    const { linkDetails } = await import("@/lib/knowledge-proposals");
    expect(
      linkDetails({ entityName: "NUX Inc", routeToNames: ["איילה"], processName: "P1", systemNames: ["Doka"], approverName: "הדס", billingCycle: "ANNUAL", billingCostMinor: 120000, billingCurrency: "USD", cardLast4: "4242", invoiceTo: "billing-us@nux.ai" })
    ).toEqual(["ישות: NUX Inc", "מפנים אל: איילה", "מפעיל את: P1", "מערכות: Doka", "מאשר: הדס", "חיוב: שנתי, 1,200 USD, כרטיס 4242", "חשבונית אל: billing-us@nux.ai"]);
    expect(linkDetails({ title: "x" })).toEqual([]);
  });
});
