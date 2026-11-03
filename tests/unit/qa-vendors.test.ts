import { describe, expect, it } from "vitest";
import { unregistered } from "../../qa/checks/vendors.mjs";

// P8 (3.11.2026): QA asks about a new package or environment variable,
// because either can be a new vendor reaching client data.

const registry = { dependencies: { next: null, resend: "Resend" }, env: { RESEND_API_KEY: "Resend", NODE_ENV: null } };

describe("unregistered", () => {
  it("is empty when the registry knows everything the code uses", () => {
    const out = unregistered({ dependencies: { next: "1", resend: "1" } }, ["process.env.RESEND_API_KEY; process.env.NODE_ENV"], registry);
    expect(out).toEqual({ dependencies: [], env: [] });
  });

  it("names a new package and a new environment variable", () => {
    const out = unregistered(
      { dependencies: { next: "1", "@pipedrive/sdk": "1" }, devDependencies: { tsx: "1" } },
      ["const k = process.env.PIPEDRIVE_API_KEY;", "process.env.NODE_ENV"],
      registry,
    );
    expect(out).toEqual({ dependencies: ["@pipedrive/sdk", "tsx"], env: ["PIPEDRIVE_API_KEY"] });
  });
});
