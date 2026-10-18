import { describe, expect, it } from "vitest";
import { clientVisibleBlocker } from "@/lib/knowledge";
import { proposalDetails, proposalProblems } from "@/lib/knowledge-proposals";
import { itemLine } from "@/lib/client-file-document";

// Spec 3.1: "visible to the client" and the item's owner, on every kind of
// item in the file.

describe("visible to the client", () => {
  it("only what everyone may read, not sensitive, and with nothing not to tell", () => {
    expect(clientVisibleBlocker({ sensitivity: "NORMAL", audience: "ALL_STAFF", doNotDisclose: null })).toBeNull();
    expect(clientVisibleBlocker({ sensitivity: "SENSITIVE" })).toMatch("רגיש");
    expect(clientVisibleBlocker({ audience: "ACCOUNT_TEAM" })).toMatch("חלק מהצוות");
    expect(clientVisibleBlocker({ doNotDisclose: "לא לספר לאורן" })).toMatch("לא לספר");
    expect(clientVisibleBlocker({ doNotDisclose: "  " })).toBeNull();
  });

  it("a proposal that asks for it where it is forbidden is blocked; one that asks where it may is not", () => {
    const blocked = proposalProblems("FACT", { kind: "NOTE", body: "x", clientVisible: true, sensitivity: "SENSITIVE" }, []);
    expect(blocked).toEqual([expect.objectContaining({ code: "VISIBLE", block: true })]);
    expect(proposalProblems("FACT", { kind: "NOTE", body: "x", clientVisible: true }, [])).toEqual([]);
  });

  it("the review card and the file say both", () => {
    expect(proposalDetails("SYSTEM", { systemName: "Mercury", clientVisible: true, ownerName: "הדס" })).toEqual(["גלוי ללקוח", "בעלים: הדס"]);
    expect(proposalDetails("SYSTEM", { systemName: "Mercury" })).toEqual([]);
    expect(itemLine({ text: "Mercury", clientVisible: true, owner: "הדס", sources: ["S1"] })).toBe("Mercury {גלוי ללקוח · בעלים: הדס} [S1]");
    expect(itemLine({ text: "Mercury", owner: null })).toBe("Mercury");
  });
});
