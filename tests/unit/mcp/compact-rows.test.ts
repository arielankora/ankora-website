import { describe, expect, it } from "vitest";
import { compactRow } from "@/lib/mcp/compact-rows";

// get_proposal_stats rows, written short (17.11.2026, stage 4 of the Claude
// usage work). Nothing is lost: a missing field is false, null or empty,
// and the two left out fields repeat another one.

const ROW = {
  id: "cmwkl4nw8002c2ce1iyy2mtlc",
  client: "L3",
  kind: "rule",
  target: "RULE",
  action: "CREATE",
  via: "MCP",
  sourceKind: "MEETING",
  sourceRestriction: null,
  confidence: "HIGH",
  reviewLevel: "HIGH",
  knowledgeStatus: null,
  sensitive: false,
  clientVisible: false,
  doNotDisclose: false,
  aloneBecause: null,
  flags: [] as string[],
  blocked: false,
  state: "APPROVED",
  edited: false,
  editedFields: [] as string[],
  editKind: null,
  attached: false,
  autoApplied: true,
  reverted: false,
  autoReviewed: false,
  autoError: null,
  autoChange: null,
  bulk: false,
  rejected: false,
  createdAt: "2026-11-10T08:12:33.123Z",
  decidedAt: "2026-11-10T08:12:33.500Z",
  hoursToDecision: 0,
};

describe("compactRow", () => {
  it("leaves out false, null and empty fields, and the two that repeat another", () => {
    expect(compactRow(ROW)).toEqual({
      id: "cmwkl4nw8002c2ce1iyy2mtlc",
      client: "L3",
      kind: "rule",
      target: "RULE",
      action: "CREATE",
      via: "MCP",
      sourceKind: "MEETING",
      confidence: "HIGH",
      reviewLevel: "HIGH",
      state: "APPROVED",
      autoApplied: true,
      createdAt: "2026-11-10T08:12Z",
      hoursToDecision: 0,
    });
  });

  it("keeps every true flag, every non-empty list and every object", () => {
    const row = { ...ROW, sensitive: true, flags: ["DATE_PAST"], editedFields: ["name"], autoError: { type: "REVERTED", fields: ["name"] } };
    expect(compactRow(row)).toMatchObject({ sensitive: true, flags: ["DATE_PAST"], editedFields: ["name"], autoError: { type: "REVERTED", fields: ["name"] } });
  });

  it("is at least half the size of the full row", () => {
    expect(JSON.stringify(compactRow(ROW)).length).toBeLessThan(JSON.stringify(ROW).length / 2);
  });
});
