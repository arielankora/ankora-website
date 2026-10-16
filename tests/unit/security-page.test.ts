import { describe, expect, it } from "vitest";
import he from "@/content/security/he";
import en from "@/content/security/en";
import legalHe from "@/content/legal/he";
import legalEn from "@/content/legal/en";
import { SECURITY_GATES, openOnly, openText, type SecurityGate } from "@/content/security/gates";
import { SECURITY_CONTACT } from "@/lib/security-txt";

const ALL_OPEN = Object.fromEntries(Object.keys(SECURITY_GATES).map((k) => [k, true])) as Record<SecurityGate, boolean>;
const ALL_CLOSED = Object.fromEntries(Object.keys(SECURITY_GATES).map((k) => [k, false])) as Record<SecurityGate, boolean>;

/** Every gate key used anywhere in a locale's content, in document order. */
function gatesIn(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => gatesIn(v, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (k === "gate" && typeof v === "string") out.push(v);
      else gatesIn(v, out);
    }
  }
  return out;
}

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => strings(v, out));
  return out;
}

function subProcessors(legal: typeof legalHe): string[] {
  const section = legal.pages.privacy.sections.find((s) => s.id === "sub-processors");
  return (section?.table?.rows ?? []).map((row) => row[0]);
}

describe("security page content", () => {
  it("gates the same claims in both languages", () => {
    expect(gatesIn(en)).toEqual(gatesIn(he));
  });

  it("uses only gates that exist", () => {
    for (const gate of gatesIn(he)) expect(Object.keys(SECURITY_GATES)).toContain(gate);
  });

  it("names the same vendors, with the same policy links, in both languages", () => {
    expect(en.vendors.rows.map((v) => [v.name, v.policyUrl, v.gate])).toEqual(
      he.vendors.rows.map((v) => [v.name, v.policyUrl, v.gate])
    );
    for (const v of he.vendors.rows) expect(v.policyUrl).toMatch(/^https:\/\//);
  });

  it("shows exactly the sub-processors the privacy policy names", () => {
    for (const legal of [legalHe, legalEn]) {
      const listed = subProcessors(legal);
      expect(listed.length).toBeGreaterThan(0);
      const live = openOnly(he.vendors.rows).map((v) => v.name);
      expect(live.sort()).toEqual([...listed].sort());
    }
  });

  it("keeps a gated claim off the page until its gate opens", () => {
    const closed = openOnly(he.vendors.rows, ALL_CLOSED).map((v) => v.name);
    const open = openOnly(he.vendors.rows, ALL_OPEN).map((v) => v.name);
    expect(closed).not.toContain("OpenAI");
    expect(open).toContain("OpenAI");
    expect(openText(he.vendors.body, ALL_CLOSED)).not.toContain("הסכם עיבוד מידע");
    expect(openText(he.vendors.body, ALL_OPEN)).toContain("הסכם עיבוד מידע");
    expect(openOnly(he.ai.commitments, ALL_CLOSED).map((c) => c.title)).toEqual(["אדם מאשר."]);
  });

  it("points vulnerability reports at the security.txt contact", () => {
    expect(he.documents.disclosureEmail).toBe(SECURITY_CONTACT.replace(/^mailto:/, ""));
    expect(en.documents.disclosureEmail).toBe(he.documents.disclosureEmail);
  });

  it("has no em or en dash anywhere", () => {
    for (const s of [...strings(he), ...strings(en)]) expect(s).not.toMatch(/[\u2013\u2014]/);
  });
});
