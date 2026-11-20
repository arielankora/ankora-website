import { describe, expect, it } from "vitest";
import { previousVersions } from "@/lib/fact-versions";

// 20.11.2026 (Ariel): a fact shows the versions it replaced.
describe("previousVersions", () => {
  it("gives each current fact its chain, newest first, and leaves the rest for the history", () => {
    const current = [{ id: "c" }, { id: "x" }];
    const superseded = [
      { id: "a", supersededById: "b" },
      { id: "b", supersededById: "c" },
      { id: "lost", supersededById: "gone" },
    ];
    const r = previousVersions(current, superseded);
    expect(r.previous.get("c")!.map((v) => v.id)).toEqual(["b", "a"]);
    expect(r.previous.get("x")).toEqual([]);
    expect(r.orphans.map((v) => v.id)).toEqual(["lost"]);
  });

  it("stops on a loop instead of running forever", () => {
    const r = previousVersions([{ id: "c" }], [{ id: "a", supersededById: "c" }, { id: "c2", supersededById: "a" }]);
    expect(r.previous.get("c")!.map((v) => v.id)).toEqual(["a", "c2"]);
  });
});
