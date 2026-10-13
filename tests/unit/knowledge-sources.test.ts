import { describe, expect, it } from "vitest";
import {
  checkSources,
  citedCodes,
  defaultWeight,
  formatSourceRef,
  parseSourceRefs,
  readSourceRefs,
} from "@/lib/knowledge-sources";
import { isPublicEmailDomain } from "@/lib/contact-normalize";

describe("parseSourceRefs", () => {
  it("reads codes and minutes the way people type them", () => {
    expect(parseSourceRefs("S1 08:13, s3\n[S4 1:02:03]; S2@5:01")).toEqual({
      refs: [{ code: "S1", at: "08:13" }, { code: "S3" }, { code: "S4", at: "1:02:03" }, { code: "S2", at: "05:01" }],
      invalid: [],
    });
  });

  it("returns what it cannot read by name, and drops duplicates", () => {
    expect(parseSourceRefs("S1, S1, X7, S0, S2 8:75")).toEqual({ refs: [{ code: "S1" }], invalid: ["X7", "S0", "S2 8:75"] });
    expect(parseSourceRefs("")).toEqual({ refs: [], invalid: [] });
  });

  it("formats back to what was typed", () => {
    expect(formatSourceRef({ code: "S1", at: "08:13" })).toBe("S1 08:13");
    expect(formatSourceRef({ code: "S3" })).toBe("S3");
  });
});

describe("readSourceRefs", () => {
  it("keeps only well-formed entries", () => {
    expect(readSourceRefs([{ code: "S1", at: "08:13" }, { code: "x" }, null, "S2", { code: "S2" }])).toEqual([
      { code: "S1", at: "08:13" },
      { code: "S2" },
    ]);
    expect(readSourceRefs({})).toEqual([]);
  });
});

describe("citedCodes", () => {
  it("finds bracketed codes only", () => {
    expect(citedCodes("לפי [S1 08:13] ו-[S2, s4]. S9 class לא נחשב.")).toEqual(["S1", "S2", "S4"]);
    expect(citedCodes(null)).toEqual([]);
  });
});

describe("checkSources", () => {
  const register = [
    { code: "S1", weight: "PRIMARY" as const },
    { code: "S2", weight: "SECONDARY" as const },
  ];

  it("needs a source unless the item is missing", () => {
    expect(checkSources("CONFIRMED", [], register)).toMatchObject({ ok: false });
    expect(checkSources("UNCERTAIN", [], register)).toMatchObject({ ok: false });
    expect(checkSources("MISSING", [], register)).toEqual({ ok: true, status: "MISSING", lowered: false });
  });

  it("refuses codes the register does not have, in fields and in text", () => {
    expect(checkSources("CONFIRMED", [{ code: "S7" }], register)).toEqual({ ok: false, error: "המקור S7 לא קיים במרשם של הלקוח." });
    const r = checkSources("CONFIRMED", [{ code: "S1" }], register, ["ראו [S8] ו-[S9]"]);
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.error).toContain("S8, S9");
  });

  it("lowers a confirmed item whose sources are all secondary (R14)", () => {
    expect(checkSources("CONFIRMED", [{ code: "S2" }], register)).toEqual({ ok: true, status: "UNCERTAIN", lowered: true });
    expect(checkSources("CONFIRMED", [{ code: "S2" }, { code: "S1" }], register)).toEqual({ ok: true, status: "CONFIRMED", lowered: false });
    expect(checkSources("UNCERTAIN", [{ code: "S2" }], register)).toEqual({ ok: true, status: "UNCERTAIN", lowered: false });
  });
});

describe("defaultWeight and public domains", () => {
  it("treats Ankora's documents as secondary", () => {
    expect(defaultWeight("ANKORA_DOCUMENT")).toBe("SECONDARY");
    expect(defaultWeight("TRANSCRIPT")).toBe("PRIMARY");
  });

  it("knows the mail providers that identify nobody", () => {
    expect(isPublicEmailDomain("Gmail.com")).toBe(true);
    expect(isPublicEmailDomain("walla.co.il")).toBe(true);
    expect(isPublicEmailDomain("nux.ai")).toBe(false);
  });
});
