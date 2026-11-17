// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { intlWrapper } from "../helpers/intl";
import { pauseUrl } from "@/lib/approval-links";
import { parseApprovalsParams } from "@/lib/approvals";
import { pauseErrorsLine } from "@/lib/auto-apply";
import { HEBREW } from "@/lib/i18n/outgoing";

// A direct link to one pause on "נכנס אוטומטית" (17.11.2026): the link
// Claude hands a manager (pauseUrl) opens the knowledge tab, on the
// pause's client when it is a client's, and lands on the pause's own row.

vi.mock("@/components/app/toast/ToastProvider", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("@/app/(product)/app/(authenticated)/knowledge/actions", () => ({
  liftAutoApplyPauseAction: vi.fn(),
  markAutoReviewedAction: vi.fn(),
  revertProposalAction: vi.fn(),
  setAutoApplyAction: vi.fn(),
}));
import { AutoApplied, type AutoApplyPauseRow } from "@/app/(product)/app/(authenticated)/knowledge/AutoApplied";

afterEach(cleanup);

const BASE = "https://www.ankora.co.il";

function pause(over: Partial<AutoApplyPauseRow>): AutoApplyPauseRow {
  return {
    id: "pz1",
    scope: "CLIENT",
    kindKey: null,
    clientName: "NUX",
    reason: "2 פריטים שנכנסו אוטומטית בוטלו",
    since: new Date("2026-11-10T10:00:00Z"),
    decisions: 0,
    approvedAsIs: 0,
    lowerBoundPct: 0,
    barMet: false,
    errorTypes: [{ type: "REVERTED", count: 2, fields: [] }],
    ...over,
  };
}

function landsOn(url: string) {
  const u = new URL(url);
  return { params: parseApprovalsParams(Object.fromEntries(u.searchParams)), anchor: u.hash.slice(1) };
}

describe("the link to a pause", () => {
  it("opens the knowledge tab on the client, and the row with that id is on the card", () => {
    const client = pause({ id: "pz1" });
    const kind = pause({ id: "pz2", scope: "KIND", kindKey: "CONTACT", clientName: null });
    render(<AutoApplied rows={[]} controls={{ enabled: true, firstEnabled: null, pauses: [client, kind] }} />, { wrapper: intlWrapper() });

    const a = landsOn(pauseUrl(BASE, { id: client.id, clientId: "c1" }));
    expect(a.params).toEqual({ tab: "knowledge", clientId: "c1" });
    const row = document.getElementById(a.anchor);
    expect(row?.getAttribute("data-testid")).toBe("auto-apply-pause");
    expect(row?.textContent).toContain("NUX");
    // The highlight reaches the card's edges, and the row clears the header.
    expect(row?.className).toContain("target:bg-app-accent-soft");
    expect(row?.className).toContain("-mx-5");
    expect(row?.className).toContain("scroll-mt-24");

    const b = landsOn(pauseUrl(BASE, { id: kind.id, clientId: null }));
    expect(b.params).toEqual({ tab: "knowledge", clientId: null });
    expect(document.getElementById(b.anchor)?.getAttribute("data-testid")).toBe("auto-apply-pause");
    expect(screen.getAllByTestId("auto-apply-pause")).toHaveLength(2);
  });
});

describe("what caused a pause, in one line", () => {
  const words = {
    type: (type: string, count: number) => `${count} ${type}`,
    field: (f: string) => (f === "role" ? "תפקיד" : null),
    line: (count: number, parts: string) => `${count}: ${parts}`,
  };

  it("names each type with its fields, a field with no label by its name, three at most", () => {
    expect(
      pauseErrorsLine(words, [
        { type: "UPDATED", count: 2, fields: ["role", "emails", "phones", "name"] },
        { type: "REMOVED", count: 1, fields: [] },
      ])
    ).toBe("3: 2 UPDATED (תפקיד, emails, phones), 1 REMOVED");
    expect(pauseErrorsLine(words, [])).toBeNull();
  });

  it("in the screen's Hebrew words, as list_approvals gives it", () => {
    const he = { type: (type: string, count: number) => HEBREW.root(`knowledge.auto.errorTypes.${type}`, { count }), field: () => "תפקיד", line: (count: number, parts: string) => HEBREW.root("knowledge.auto.pauseErrors", { count, parts }) };
    expect(pauseErrorsLine(he, [{ type: "UPDATED", count: 2, fields: ["role"] }, { type: "REMOVED", count: 1, fields: [] }])).toBe("3 טעויות: 2 עריכות (תפקיד), מחיקה אחת");
  });
});
