import { describe, expect, it } from "vitest";
import { checkCommsGrant, levelNeedsConfidentiality, mergeLineOwners } from "@/lib/comms/grant-rules";

// The rules behind giving access to the communications screen in the app
// (12.11.2026).

describe("which levels wait for the confidentiality undertaking", () => {
  it("OWN is given at once (Ariel, 12.11.2026); CALLS and FULL wait", () => {
    expect(levelNeedsConfidentiality("NONE")).toBe(false);
    expect(levelNeedsConfidentiality("OWN")).toBe(false);
    expect(levelNeedsConfidentiality("CALLS")).toBe(true);
    expect(levelNeedsConfidentiality("FULL")).toBe(true);
  });

  it("refuses FULL before both signatures, allows it after", () => {
    expect(checkCommsGrant({ level: "FULL", targetRole: "ANKORA_EMPLOYEE", confidentialitySigned: false }).ok).toBe(false);
    expect(checkCommsGrant({ level: "FULL", targetRole: "ANKORA_EMPLOYEE", confidentialitySigned: true }).ok).toBe(true);
    expect(checkCommsGrant({ level: "OWN", targetRole: "ANKORA_EMPLOYEE", confidentialitySigned: false }).ok).toBe(true);
  });

  it("a role does not open it, and a client never gets it", () => {
    expect(checkCommsGrant({ level: "OWN", targetRole: "CLIENT_USER", confidentialitySigned: true }).ok).toBe(false);
    expect(checkCommsGrant({ level: "NONE", targetRole: "CLIENT_USER", confidentialitySigned: false }).ok).toBe(true);
  });
});

describe("line owners: the app laid over the environment", () => {
  const env = new Map([
    ["+972553000001", "hadas@x.co"],
    ["+972553000002", "anna@x.co"],
  ]);

  it("keeps the environment where the app says nothing", () => {
    expect(mergeLineOwners(env, [])).toEqual(env);
  });

  it("the app moves a line, and a row with nobody takes it off", () => {
    const out = mergeLineOwners(env, [
      { line: "+972553000001", email: "Facu@X.co " },
      { line: "+972553000002", email: null },
    ]);
    expect(out.get("+972553000001")).toBe("facu@x.co");
    expect(out.has("+972553000002")).toBe(false);
  });
});
