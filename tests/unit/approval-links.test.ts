import { describe, expect, it } from "vitest";
import { approvalAnchor, approvalRowUrl, batchUrl, clientDecisionUrl, processUrl, proposalAnchor, proposalUrl } from "@/lib/approval-links";

// The links Claude hands out and the anchors the screens render are one
// definition (2.11.2026). These hold the shape a person clicks.

const BASE = "https://www.ankora.co.il/";

describe("approval links", () => {
  it("opens a row on its own tab and client, scrolled to it", () => {
    expect(approvalRowUrl(BASE, { kind: "exception", id: "ex1", clientId: "c1" })).toBe("https://www.ankora.co.il/app/approvals?tab=exception&clientId=c1#approval-exception-ex1");
    expect(approvalRowUrl(BASE, { kind: "guide", id: "g1", clientId: null })).toBe("https://www.ankora.co.il/app/approvals?tab=guide#approval-guide-g1");
  });

  it("opens a knowledge row on its batch", () => {
    expect(approvalRowUrl(BASE, { kind: "knowledge", id: "b1", clientId: "c1" })).toBe(batchUrl(BASE, "c1", "b1"));
  });

  it("keeps a process decision's id usable as an anchor", () => {
    const anchor = approvalAnchor("process", "p1:no_next_date");
    expect(anchor).toBe("approval-process-p1-no_next_date");
    expect(approvalRowUrl(BASE, { kind: "process", id: "p1:no_next_date", clientId: "c1" }).endsWith(`#${anchor}`)).toBe(true);
  });

  it("points a proposal, a process and a decision at their element", () => {
    expect(proposalUrl(BASE, "c1", "pr1")).toBe(`https://www.ankora.co.il/app/approvals?tab=knowledge&clientId=c1#${proposalAnchor("pr1")}`);
    expect(processUrl(BASE, "c1", "p1")).toBe("https://www.ankora.co.il/app/clients/c1?tab=file#item-p1");
    expect(clientDecisionUrl(BASE, "c1", "d1")).toBe("https://www.ankora.co.il/app/clients/c1#decision-d1");
  });
});
