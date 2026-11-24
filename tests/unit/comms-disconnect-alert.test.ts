import { describe, it, expect } from "vitest";
import { DISCONNECT_CC, disconnectCc } from "@/lib/comms/disconnect-alert";

// 24.11.2026: a disconnected WhatsApp goes to its owner, with Ariel and Hadas on copy.
describe("disconnectCc", () => {
  it("copies Ariel and Hadas on another employee's number", () => {
    expect(disconnectCc("maor@ankora.co.il")).toEqual(["ariel@ankora.co.il", "hadas@ankora.co.il"]);
  });

  it("does not copy the owner on their own email", () => {
    expect(disconnectCc("Hadas@Ankora.co.il")).toEqual(["ariel@ankora.co.il"]);
    expect(disconnectCc("ariel@ankora.co.il")).toEqual(["hadas@ankora.co.il"]);
  });

  it("keeps the whole list when the owner has no email", () => {
    expect(disconnectCc(null)).toEqual(DISCONNECT_CC);
  });
});
