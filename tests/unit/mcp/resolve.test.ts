import { describe, expect, it } from "vitest";
import { describeResolveFailure, normalizeName, resolveByName } from "@/lib/mcp/resolve";

// Phase 13 (MCP server, docs/adr/0005). This is the highest-risk module in
// the MCP surface: it is what stands between "the model said a client
// name" and "time was written against a client id". Every case below is a
// way that could go wrong in production, so the bar is that resolution
// either returns exactly one match or refuses - it must never pick.

const CLIENTS = [
  { id: "c1", name: "אנקורה" },
  { id: "c2", name: "אנקורה 360" },
  { id: "c3", name: "Globex" },
  { id: "c4", name: "Globex Industries" },
  { id: "c5", name: "Initech" },
];

describe("normalizeName()", () => {
  it("collapses runs of whitespace and trims", () => {
    expect(normalizeName("  Globex   Industries ")).toBe("globex industries");
  });

  it("folds case for Latin text", () => {
    expect(normalizeName("GLOBEX")).toBe(normalizeName("globex"));
  });

  it("strips the invisible bidi marks that ride along with copied Hebrew", () => {
    expect(normalizeName("‏אנקורה‎")).toBe("אנקורה");
  });

  it("normalises Unicode form so two spellings of the same name match", () => {
    // U+05D0 + combining point vs. the precomposed form.
    const decomposed = "á"; // a + combining acute
    const precomposed = "á"; // á
    expect(normalizeName(decomposed)).toBe(normalizeName(precomposed));
  });
});

describe("resolveByName()", () => {
  it("resolves an unambiguous exact match", () => {
    const result = resolveByName("Initech", CLIENTS);
    expect(result.status).toBe("ok");
    expect(result.status === "ok" && result.match.id).toBe("c5");
  });

  it("lets an exact match win over a longer name it is a prefix of", () => {
    // The regression this rule exists for: without exact-match precedence,
    // "אנקורה" could never be selected while "אנקורה 360" exists.
    const result = resolveByName("אנקורה", CLIENTS);
    expect(result.status).toBe("ok");
    expect(result.status === "ok" && result.match.id).toBe("c1");
  });

  it("resolves a unique prefix", () => {
    const result = resolveByName("Initec", CLIENTS);
    expect(result.status === "ok" && result.match.id).toBe("c5");
  });

  it("refuses when a prefix matches more than one client", () => {
    const result = resolveByName("Glob", CLIENTS);
    expect(result.status).toBe("ambiguous");
    expect(result.status === "ambiguous" && result.candidates.map((c) => c.id)).toEqual(["c3", "c4"]);
  });

  it("does not break the tie by name length", () => {
    // "Globex" is both an exact match AND a prefix of "Globex Industries".
    // Exact wins - but "Glob" matches neither exactly, and must NOT
    // silently resolve to the shorter one.
    expect(resolveByName("Globex", CLIENTS).status).toBe("ok");
    expect(resolveByName("Glob", CLIENTS).status).toBe("ambiguous");
  });

  it("falls back to substring only when prefix found nothing", () => {
    const result = resolveByName("Industries", CLIENTS);
    expect(result.status === "ok" && result.match.id).toBe("c4");
  });

  it("refuses an unknown name rather than guessing the closest", () => {
    const result = resolveByName("Acme", CLIENTS);
    expect(result.status).toBe("none");
  });

  it("refuses an empty or whitespace query", () => {
    expect(resolveByName("", CLIENTS).status).toBe("none");
    expect(resolveByName("   ", CLIENTS).status).toBe("none");
  });

  it("refuses against an empty candidate list", () => {
    expect(resolveByName("Globex", []).status).toBe("none");
  });

  it("ignores case and stray whitespace in the query", () => {
    const result = resolveByName("  initech  ", CLIENTS);
    expect(result.status === "ok" && result.match.id).toBe("c5");
  });

  it("treats two identically-named rows as ambiguous, never first-wins", () => {
    const dupes = [
      { id: "d1", name: "Duplicate" },
      { id: "d2", name: "Duplicate" },
    ];
    const result = resolveByName("Duplicate", dupes);
    expect(result.status).toBe("ambiguous");
  });
});

describe("describeResolveFailure()", () => {
  it("names every candidate and tells the model to ask, not choose", () => {
    const result = resolveByName("Glob", CLIENTS);
    if (result.status === "ok") throw new Error("expected ambiguity");
    const message = describeResolveFailure(result, "client", CLIENTS);
    expect(message).toContain("Globex");
    expect(message).toContain("Globex Industries");
    expect(message).toMatch(/do not pick one yourself/i);
  });

  it("lists what IS available when nothing matched", () => {
    const result = resolveByName("Acme", CLIENTS);
    if (result.status === "ok") throw new Error("expected no match");
    const message = describeResolveFailure(result, "client", CLIENTS);
    expect(message).toContain("Initech");
    expect(message).toMatch(/do not retry with a guess/i);
  });

  it("caps the list so a typo cannot dump a hundred names into context", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ id: `x${i}`, name: `Client ${i}` }));
    const result = resolveByName("zzz", many);
    if (result.status === "ok") throw new Error("expected no match");
    const message = describeResolveFailure(result, "client", many);
    expect(message).toContain("and 35 more");
    expect(message).not.toContain("Client 40");
  });

  it("says so plainly when the user has access to nothing at all", () => {
    const result = resolveByName("anything", []);
    if (result.status === "ok") throw new Error("expected no match");
    const message = describeResolveFailure(result, "client", []);
    expect(message).toMatch(/access to none at all/i);
  });
});
