import { describe, expect, it } from "vitest";
import { policyVersions } from "@/lib/client-policies";
import { fieldStatusFrom, missingLine } from "@/lib/knowledge";

describe("a rule's earlier versions", () => {
  const at = (d: string) => new Date(`2026-10-${d}T10:00:00Z`);
  it("one per version, as it last stood, newest first, without the current one", () => {
    const events = [
      { createdAt: at("01"), before: null, after: { version: 1, title: "דיווח", statement: "חודשי", status: "PROPOSED", approvedById: null } },
      { createdAt: at("02"), before: { version: 1, status: "PROPOSED" }, after: { version: 1, title: "דיווח", statement: "חודשי", status: "ACTIVE", approvedById: "u1", approvedAt: "2026-10-02T10:00:00.000Z" } },
      { createdAt: at("05"), before: { version: 1, title: "דיווח", statement: "חודשי", status: "ACTIVE", approvedById: "u1" }, after: { version: 2, title: "דיווח", statement: "שבועי", status: "PROPOSED" } },
      { createdAt: at("06"), before: { version: 2, statement: "שבועי" }, after: { version: 3, title: "דיווח", statement: "יומי", status: "PROPOSED" } },
    ];
    const v = policyVersions(events, 3);
    expect(v.map((x) => x.version)).toEqual([2, 1]);
    expect(v[1]).toMatchObject({ statement: "חודשי", approvedById: "u1", until: at("05").toISOString() });
    expect(v[0]).toMatchObject({ statement: "שבועי", until: at("06").toISOString() });
  });
});

describe("missing fields of a contact or a system", () => {
  it("keeps only known fields, always with what closes them", () => {
    expect(fieldStatusFrom("SYSTEM", ["url", "nope"], "")).toEqual({ url: { status: "MISSING", toResolve: "לברר" } });
    expect(missingLine("CONTACT", { emails: { status: "MISSING", toResolve: "לבקש מגיא" }, phones: { status: "MISSING", toResolve: "לבקש מגיא" } })).toBe("חסר: מייל, טלפון · לבקש מגיא");
    expect(missingLine("CONTACT", {})).toBeNull();
  });
});
