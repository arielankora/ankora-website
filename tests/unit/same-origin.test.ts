import { describe, expect, it } from "vitest";
import { isSameOriginJsonPost } from "@/lib/same-origin";

function req(headers: Record<string, string>) {
  return new Request("https://ankora.co.il/api/step-up", { method: "POST", headers });
}

describe("isSameOriginJsonPost", () => {
  it("accepts a JSON post from this host", () => {
    expect(isSameOriginJsonPost(req({ "content-type": "application/json", origin: "https://ankora.co.il", host: "ankora.co.il" }))).toBe(true);
  });
  it("refuses another origin", () => {
    expect(isSameOriginJsonPost(req({ "content-type": "application/json", origin: "https://evil.example", host: "ankora.co.il" }))).toBe(false);
  });
  it("refuses a form post, which a cross-site page can send without a preflight", () => {
    expect(isSameOriginJsonPost(req({ "content-type": "application/x-www-form-urlencoded", origin: "https://ankora.co.il", host: "ankora.co.il" }))).toBe(false);
  });
  it("refuses a missing Origin", () => {
    expect(isSameOriginJsonPost(req({ "content-type": "application/json", host: "ankora.co.il" }))).toBe(false);
  });
});
