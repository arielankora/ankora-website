import { describe, expect, it } from "vitest";
import { linesOwnedBy, parseLineOwners, storedCallLine } from "@/lib/comms/call-lines";

describe("call lines and their owners", () => {
  it("reads line=email pairs and skips what is not one", () => {
    const owners = parseLineOwners("055-3302266=Hadas@Example.com, +972553356775=anna@example.com,junk,=x@y.z,+97255=");
    expect([...owners]).toEqual([
      ["+972553302266", "hadas@example.com"],
      ["+972553356775", "anna@example.com"],
    ]);
    expect(parseLineOwners(undefined).size).toBe(0);
  });

  it("finds the lines of one person", () => {
    const owners = parseLineOwners("+972553302266=hadas@example.com,+972553356775=anna@example.com");
    expect(linesOwnedBy(owners, "ANNA@example.com")).toEqual(["+972553356775"]);
    expect(linesOwnedBy(owners, "ariel@example.com")).toEqual([]);
    expect(linesOwnedBy(owners, null)).toEqual([]);
  });

  it("knows our line on a stored call from its direction", () => {
    expect(storedCallLine({ direction: "IN", fromPhone: "+1", toPhone: "+2" })).toBe("+2");
    expect(storedCallLine({ direction: "OUT", fromPhone: "+1", toPhone: "+2" })).toBe("+1");
    expect(storedCallLine({ direction: "UNKNOWN", fromPhone: "+1", toPhone: "+2" })).toBeNull();
  });
});
