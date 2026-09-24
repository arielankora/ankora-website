import { describe, it, expect, vi, beforeEach } from "vitest";

const create = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: { auditEvent: { create: (a: unknown) => create(a) } } }));

let headersImpl: () => Promise<Headers> = async () => new Headers();
vi.mock("next/headers", () => ({ headers: () => headersImpl() }));

import { recordAudit } from "@/lib/app-auth/audit";

beforeEach(() => {
  create.mockReset();
});

describe("recordAudit request context (DPA Annex II: IP address and browser)", () => {
  it("fills ip and userAgent from the current request when the caller did not pass them", async () => {
    headersImpl = async () =>
      new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1", "user-agent": "Mozilla/5.0 Test" });
    await recordAudit({ actorId: "u1", action: "login.success", entityType: "User", entityId: "u1" });
    const data = create.mock.calls[0][0].data;
    expect(data.ip).toBe("203.0.113.7");
    expect(data.userAgent).toBe("Mozilla/5.0 Test");
  });

  it("stores null outside a request (cron, backup), where headers() throws", async () => {
    headersImpl = async () => {
      throw new Error("headers was called outside a request scope");
    };
    await recordAudit({ actorId: null, action: "backup.nightly_export.sent", entityType: "System" });
    const data = create.mock.calls[0][0].data;
    expect(data.ip).toBeNull();
    expect(data.userAgent).toBeNull();
  });

  it("lets an explicit caller value win, including an explicit null", async () => {
    headersImpl = async () => new Headers({ "x-real-ip": "198.51.100.2", "user-agent": "UA" });
    await recordAudit({ actorId: "u1", action: "x", entityType: "User", ip: "192.0.2.9", userAgent: null });
    const data = create.mock.calls[0][0].data;
    expect(data.ip).toBe("192.0.2.9");
    expect(data.userAgent).toBeNull();
  });

  it("does not store the placeholder 'unknown' as an IP, and caps a long user agent", async () => {
    headersImpl = async () => new Headers({ "user-agent": "a".repeat(2000) });
    await recordAudit({ actorId: "u1", action: "x", entityType: "User" });
    const data = create.mock.calls[0][0].data;
    expect(data.ip).toBeNull();
    expect(data.userAgent).toHaveLength(512);
  });
});
