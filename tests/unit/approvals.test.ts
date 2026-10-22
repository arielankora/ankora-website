import { describe, expect, it } from "vitest";
import {
  APPROVAL_TABS,
  approvalsHref,
  approvalsLine,
  bulkRuleGroups,
  forClient,
  parseApprovalsParams,
  sortByWaiting,
  tabCounts,
  visibleTabs,
  waitedLabel,
  type ApprovalItem,
} from "@/lib/approvals";

// "אישורים" (20.10.2026): one definition of the tabs, their order, what
// each counts and which a person sees.

const at = (d: string) => new Date(`${d}T09:00:00Z`);

function item(over: Partial<ApprovalItem>): ApprovalItem {
  return {
    kind: "rule",
    id: Math.random().toString(36).slice(2),
    clientId: "c1",
    clientName: "NUX",
    title: "כלל",
    since: at("2026-10-15"),
    href: "/app/clients/c1",
    actions: { approve: "אישור", reject: null },
    ...over,
  };
}

describe("approvals", () => {
  it("keeps the tabs in the agreed order, most urgent first, the questions last", () => {
    expect(APPROVAL_TABS.map((t) => t.key)).toEqual(["all", "task", "exception", "rule", "procedure", "process", "knowledge", "plan", "summary", "guide", "check", "questions"]);
  });

  it("lists what waited longest first", () => {
    const rows = sortByWaiting([item({ title: "ב", since: at("2026-10-19") }), item({ title: "א", since: at("2026-10-10") }), item({ title: "ג", since: at("2026-10-19") })]);
    expect(rows.map((r) => r.title)).toEqual(["א", "ב", "ג"]);
  });

  it("counts a knowledge batch as its proposals, and leaves the questions for the client out of all", () => {
    const counts = tabCounts([item({ kind: "task" }), item({ kind: "rule" }), item({ kind: "rule" }), item({ kind: "knowledge", weight: 6 }), item({ kind: "process" })], 9);
    expect(counts.task).toBe(1);
    expect(counts.rule).toBe(2);
    expect(counts.knowledge).toBe(6);
    expect(counts.process).toBe(1);
    expect(counts.all).toBe(10);
    expect(counts.questions).toBe(9);
  });

  it("takes the review screen's own count for knowledge when it is given", () => {
    const counts = tabCounts([item({ kind: "knowledge", weight: 6 }), item({ kind: "task" })], 0, 7);
    expect(counts.knowledge).toBe(7);
    expect(counts.all).toBe(8);
  });

  it("shows all, the tabs that hold something, the questions, and the one asked for", () => {
    const counts = tabCounts([item({ kind: "task" }), item({ kind: "exception" })], 0);
    expect(visibleTabs(counts, "all").map((t) => t.key)).toEqual(["all", "task", "exception", "questions"]);
    // A manager-only tab never shows to someone with nothing in it...
    expect(visibleTabs(counts, "all").some((t) => t.key === "rule")).toBe(false);
    // ...unless it is the address they opened.
    expect(visibleTabs(counts, "guide").map((t) => t.key)).toEqual(["all", "task", "exception", "guide", "questions"]);
  });

  it("filters by client, and keeps rows that belong to no client out of a client's view", () => {
    const rows = [item({ clientId: "c1" }), item({ clientId: "c2" }), item({ kind: "guide", clientId: null })];
    expect(forClient(rows, "c2")).toHaveLength(1);
    expect(forClient(rows, null)).toHaveLength(3);
  });

  it("reads the tab and the client from the address, with client as an alias", () => {
    expect(parseApprovalsParams({ tab: "rule", clientId: "c1" })).toEqual({ tab: "rule", clientId: "c1" });
    expect(parseApprovalsParams({ tab: "nonsense", client: "c2" })).toEqual({ tab: "all", clientId: "c2" });
    expect(parseApprovalsParams({})).toEqual({ tab: "all", clientId: null });
    // "לבדיקה" became the questions for the client on 22.10.2026.
    expect(parseApprovalsParams({ tab: "review" })).toEqual({ tab: "questions", clientId: null });
  });

  it("writes the address back", () => {
    expect(approvalsHref("all", null)).toBe("/app/approvals");
    expect(approvalsHref("knowledge", "c1")).toBe("/app/approvals?tab=knowledge&clientId=c1");
    expect(approvalsHref("all", "c1")).toBe("/app/approvals?clientId=c1");
  });

  it("says how long it waited", () => {
    const now = at("2026-10-20");
    expect(waitedLabel(at("2026-10-20"), now)).toBe("מהיום");
    expect(waitedLabel(at("2026-10-19"), now)).toBe("מאתמול");
    expect(waitedLabel(at("2026-10-15"), now)).toBe("כבר 5 ימים");
  });

  it("writes the morning email's line, or none", () => {
    expect(approvalsLine(0)).toBeNull();
    expect(approvalsLine(1)).toBe("דבר אחד מחכה לאישור שלך.");
    expect(approvalsLine(12)).toBe("12 דברים מחכים לאישור שלך.");
  });

  it("groups the confirmed rules of a client for approving together, two or more", () => {
    const rows = [
      item({ id: "a", clientId: "c1" }),
      item({ id: "b", clientId: "c1" }),
      item({ id: "c", clientId: "c1", actions: { approve: null, reject: null } }),
      item({ id: "d", clientId: "c2", clientName: "RIMED" }),
      item({ id: "e", kind: "task", clientId: "c2" }),
    ];
    expect(bulkRuleGroups(rows)).toEqual([{ clientId: "c1", clientName: "NUX", ids: ["a", "b"] }]);
  });
});
