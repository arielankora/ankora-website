import { describe, expect, it } from "vitest";
import { buildCallBlockIndex, linesOf } from "@/lib/comms/call-block-rules";

const HADAS_LINE = "+972553302266";
const ANNA_LINE = "+972553356775";
const owners = new Map([
  [HADAS_LINE, "hadas"],
  [ANNA_LINE, "anna"],
]);

describe("blocks on call recordings", () => {
  it("holds on the line of the person who blocked, and on no other line", () => {
    const index = buildCallBlockIndex(owners, [{ ownerUserId: "hadas", phone: "+97254", status: "APPROVED" }]);
    expect(index.stateFor(HADAS_LINE, "+97254")).toBe("blocked");
    expect(index.stateFor(ANNA_LINE, "+97254")).toBe("none");
    expect(index.stateFor(HADAS_LINE, "+97255")).toBe("none");
  });

  it("tells a request from a block in force, and the block wins", () => {
    const pending = buildCallBlockIndex(owners, [{ ownerUserId: "hadas", phone: "+97254", status: "PENDING" }]);
    expect(pending.stateFor(HADAS_LINE, "+97254")).toBe("pending");
    const both = buildCallBlockIndex(owners, [
      { ownerUserId: "hadas", phone: "+97254", status: "APPROVED" },
      { ownerUserId: "hadas", phone: "+97254", status: "PENDING" },
    ]);
    expect(both.stateFor(HADAS_LINE, "+97254")).toBe("blocked");
  });

  it("ignores a call with no known line, a line with no owner, and a hand-sent recording", () => {
    const index = buildCallBlockIndex(new Map([[HADAS_LINE, "hadas"]]), [{ ownerUserId: "hadas", phone: HADAS_LINE, status: "APPROVED" }]);
    expect(index.stateFor(null, "+97254")).toBe("none");
    expect(index.stateFor(ANNA_LINE, "+97254")).toBe("none");
    expect(index.stateFor(HADAS_LINE, HADAS_LINE)).toBe("none");
  });

  it("lists one person's lines", () => {
    expect(linesOf(owners, "anna")).toEqual([ANNA_LINE]);
    expect(linesOf(owners, "ariel")).toEqual([]);
  });
});
