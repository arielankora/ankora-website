import { describe, expect, it, vi, beforeEach } from "vitest";

let pathname = "/app/portal";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

const { useShellNav } = await import("@/components/app/portal-preview-nav");

// 3.11.2026, Hadas's review: a manager previewing the portal sees the
// client's shell on portal screens, and their own everywhere else.
const staff = [{ href: "/app/timer", label: "טיימר" }];
const portal = [{ href: "/app/portal", label: "בית" }];

describe("useShellNav", () => {
  beforeEach(() => {
    pathname = "/app/portal";
  });

  it("keeps the staff shell when no preview is on", () => {
    expect(useShellNav(staff)).toEqual({ items: staff, inPortalPreview: false });
  });

  it("switches to the client's shell on a portal screen during a preview", () => {
    pathname = "/app/portal/hours";
    expect(useShellNav(staff, portal)).toEqual({ items: portal, inPortalPreview: true });
  });

  it("gives the staff shell back outside the portal, even with a preview on", () => {
    pathname = "/app/tasks";
    expect(useShellNav(staff, portal)).toEqual({ items: staff, inPortalPreview: false });
  });

  it("does not mistake a lookalike path for the portal", () => {
    pathname = "/app/portalx";
    expect(useShellNav(staff, portal).inPortalPreview).toBe(false);
  });
});
