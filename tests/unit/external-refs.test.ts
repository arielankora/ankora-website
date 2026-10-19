import { describe, expect, it } from "vitest";
import { parseExternalRefs, refLabel, refsText, teamRefs, withInternalRefs } from "@/lib/external-refs";
import { PAYLOADS, proposalDetails } from "@/lib/knowledge-proposals";

// Spec 3.1: the team's refs on an item, typed as text and kept as
// { system, id }; the product's own refs are never the form's to drop.

describe("external refs", () => {
  it("reads what the team types", () => {
    expect(parseExternalRefs("RAID-002, ClickUp:86c1x\nHND-014, RAID-002")).toEqual([
      { system: "RAID", id: "RAID-002" },
      { system: "ClickUp", id: "86c1x" },
      { system: "HND", id: "HND-014" },
    ]);
    expect(parseExternalRefs("ImportantDate:abc")).toEqual([]);
  });

  it("reads back as it was typed, and shows as a label", () => {
    const refs = parseExternalRefs("RAID-002, ClickUp:86c1x");
    expect(refsText(refs)).toBe("RAID-002, ClickUp:86c1x");
    expect(refs.map(refLabel)).toEqual(["RAID-002", "ClickUp 86c1x"]);
  });

  it("keeps the product's own refs when the team edits theirs", () => {
    const before = [{ system: "ImportantDate", id: "d1" }, { system: "RAID", id: "RAID-001" }];
    expect(teamRefs(before)).toEqual([{ system: "RAID", id: "RAID-001" }]);
    expect(withInternalRefs(before, [{ system: "HND", id: "HND-014" }])).toEqual([{ system: "ImportantDate", id: "d1" }, { system: "HND", id: "HND-014" }]);
  });

  it("a proposal carries them, and parses again once stored", () => {
    const once = PAYLOADS.ENTITY.parse({ name: "NUX Inc", knowledgeStatus: "CONFIRMED", externalRefs: ["RAID-002"] });
    expect(once.externalRefs).toEqual([{ system: "RAID", id: "RAID-002" }]);
    const again = PAYLOADS.ENTITY.parse(JSON.parse(JSON.stringify(once)));
    expect(again.externalRefs).toEqual(once.externalRefs);
    expect(proposalDetails("ENTITY", once)).toContain("הפניות: RAID-002");
  });
});
