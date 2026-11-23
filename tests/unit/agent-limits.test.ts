import { describe, expect, it } from "vitest";
import { LIMITS, versionProblems, type AgentParam } from "@/lib/agents/model";

const param = (i: number): AgentParam => ({ key: `p${i}`, label: `פרמטר ${i}`, level: "INSTALLATION", type: "NUMBER", required: true, default: "1", clientField: null });
const blocks = (n: number) => [{ key: "steps", kind: "steps" as const, title: "צעדים", body: Array.from({ length: n }, (_, i) => `{{p${i}}}`).join(" ") }];

describe("agent parameter limit", () => {
  it("allows 30 parameters", () => {
    expect(LIMITS.params).toBe(30);
    const params = Array.from({ length: 30 }, (_, i) => param(i));
    expect(versionProblems({ blocks: blocks(30), params }).map((p) => p.code)).not.toContain("tooManyParams");
  });

  it("refuses the 31st", () => {
    const params = Array.from({ length: 31 }, (_, i) => param(i));
    expect(versionProblems({ blocks: blocks(31), params }).map((p) => p.code)).toContain("tooManyParams");
  });
});
