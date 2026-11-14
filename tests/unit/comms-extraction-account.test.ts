import { describe, expect, it } from "vitest";
import { isExtractionAccount } from "@/lib/comms/extraction-account";

describe("the automatic extraction account", () => {
  it("is Ankora Ops when nothing is set", () => {
    expect(isExtractionAccount("ops@ankora.co.il", undefined)).toBe(true);
    expect(isExtractionAccount("OPS@ankora.co.il", "")).toBe(true);
    expect(isExtractionAccount("ariel@ankora.co.il", undefined)).toBe(false);
    expect(isExtractionAccount(null, undefined)).toBe(false);
  });

  it("is whoever COMMS_EXTRACTION_ACCOUNTS names, when set", () => {
    expect(isExtractionAccount("bot@ankora.co.il", "bot@ankora.co.il")).toBe(true);
    expect(isExtractionAccount("ops@ankora.co.il", "bot@ankora.co.il")).toBe(false);
  });
});
