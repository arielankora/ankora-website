import { describe, expect, it } from "vitest";
import { clickUpPlaceholder, getProvider } from "@/lib/app-domain/integrations";

// Phase 8: spec 17.1's interface + 17.3's "no OAuth scope until the
// integration is really built." clickUpPlaceholder is not a TODO stub -
// its rejecting behavior IS the correct, final behavior for this phase.
// These tests pin that: every mutating method resolves (never throws)
// with ok:false and an explicit reason, and healthCheck alone succeeds.
describe("clickUpPlaceholder", () => {
  it("is registered under the 'clickup' provider name", () => {
    expect(getProvider("clickup")).toBe(clickUpPlaceholder);
  });

  it("returns undefined for an unknown provider", () => {
    expect(getProvider("asana")).toBeUndefined();
  });

  it("healthCheck() succeeds and reports not_connected", async () => {
    const result = await clickUpPlaceholder.healthCheck();
    expect(result).toEqual({ ok: true, status: "not_connected" });
  });

  it("connect() rejects without throwing", async () => {
    const result = await clickUpPlaceholder.connect({});
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("disconnect(), pullTasks(), pushTimeEntry(), handleWebhook() all reject without throwing", async () => {
    await expect(clickUpPlaceholder.disconnect()).resolves.toMatchObject({ ok: false });
    await expect(clickUpPlaceholder.pullTasks()).resolves.toMatchObject({ ok: false });
    await expect(clickUpPlaceholder.pushTimeEntry()).resolves.toMatchObject({ ok: false });
    await expect(clickUpPlaceholder.handleWebhook({})).resolves.toMatchObject({ ok: false });
  });
});
