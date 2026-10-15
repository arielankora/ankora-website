import { describe, expect, it } from "vitest";
import { securityTxt, SECURITY_TXT_EXPIRES } from "@/lib/security-txt";
import { GET } from "@/app/api/security-txt/route";

const DAY = 24 * 60 * 60 * 1000;

function field(name: string): string[] {
  return securityTxt()
    .split("\n")
    .filter((l) => l.startsWith(`${name}: `))
    .map((l) => l.slice(name.length + 2));
}

describe("security.txt (RFC 9116)", () => {
  it("has the two fields the RFC requires, each exactly once", () => {
    expect(field("Contact")).toEqual(["mailto:security@ankora.co.il"]);
    expect(field("Expires")).toHaveLength(1);
  });

  it("expires within a year, as the RFC asks", () => {
    expect(Date.parse(SECURITY_TXT_EXPIRES) - Date.now()).toBeLessThan(366 * DAY);
  });

  // This one is meant to go red. When it does, move SECURITY_TXT_EXPIRES six
  // months forward, after checking security@ is still read by a person.
  it("is renewed at least 30 days before it expires", () => {
    expect(Date.parse(SECURITY_TXT_EXPIRES) - Date.now()).toBeGreaterThan(30 * DAY);
  });

  it("names its canonical address and the security page", () => {
    expect(field("Canonical")).toEqual(["https://www.ankora.co.il/.well-known/security.txt"]);
    expect(field("Policy")).toEqual(["https://www.ankora.co.il/en/security"]);
  });

  it("is served as plain UTF-8 text", async () => {
    const res = GET();
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(await res.text()).toBe(securityTxt());
  });
});
