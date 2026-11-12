// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { useFormatter } from "next-intl";
import { intlWrapper } from "../helpers/intl";

// ADR 0006: the shell speaks the reader's language, and a translation can
// never move an item between the menu and the list: that is decided by
// the group's id, which no dictionary touches.

vi.mock("next/navigation", () => ({ usePathname: () => "/app/tasks", useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ children, href, prefetch: _p, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));
vi.mock("@/components/app/ActiveTimerProvider", () => ({ useActiveTimer: () => ({ summary: null }) }));

import { Sidebar } from "@/components/app/Sidebar";
import { ACCOUNT_GROUP, type NavItem } from "@/components/app/nav-groups";
import { LiveTimerPill } from "@/components/app/LiveTimerPill";
import { BackLink } from "@/components/app/BackLink";
import { OfflineBanner } from "@/components/app/states/Offline";

afterEach(cleanup);

const ITEMS: NavItem[] = [
  { href: "/app", label: "Home", group: "work", groupLabel: "Work" },
  { href: "/app/tasks", label: "Tasks", group: "work", groupLabel: "Work" },
  { href: "/app/profile", label: "My profile", group: ACCOUNT_GROUP, groupLabel: "Account" },
];

describe("the shell in English", () => {
  it("labels the sidebar from the English dictionary and keeps account items in the menu", () => {
    render(<Sidebar items={ITEMS} userName="Dana" roleLabel="Ankora manager" />, { wrapper: intlWrapper("en") });

    expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeTruthy();
    expect(screen.getByText("Search or action")).toBeTruthy();
    expect(screen.getByText("Work")).toBeTruthy();
    expect(screen.getByText("Sign out")).toBeTruthy();
    // The account item is in the menu under the name, not in the list.
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    expect(nav.textContent).toContain("Tasks");
    expect(nav.textContent).not.toContain("My profile");
    expect(screen.getByText("My profile").closest("nav")).toBeNull();
  });

  it("says how many more timers run, with the right plural", () => {
    render(<LiveTimerPill startAt={new Date().toISOString()} extraCount={1} />, { wrapper: intlWrapper("en") });
    expect(screen.getByLabelText("and 1 more running timer")).toBeTruthy();
    cleanup();
    render(<LiveTimerPill startAt={new Date().toISOString()} extraCount={2} />, { wrapper: intlWrapper("en") });
    expect(screen.getByLabelText("and 2 more running timers")).toBeTruthy();
  });

  it("names the way back, with an arrow that turns around left to right", () => {
    render(<BackLink href="/app/tasks" label="Tasks" />, { wrapper: intlWrapper("en") });
    const link = screen.getByLabelText("Back: Tasks");
    expect(link.querySelector("svg")?.getAttribute("class")).toContain("ltr:rotate-180");
  });

  it("explains being offline", () => {
    Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
    render(<OfflineBanner pendingSyncCount={2} />, { wrapper: intlWrapper("en") });
    expect(screen.getByRole("status").textContent).toContain("No network connection.");
    expect(screen.getByRole("status").textContent).toContain("2 waiting to sync.");
    Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
  });
});

describe("the shell in Hebrew is unchanged", () => {
  it("keeps the words people already know", () => {
    render(<Sidebar items={ITEMS.map((i) => ({ ...i, groupLabel: i.group === "work" ? "עבודה" : "חשבון" }))} userName="דנה" roleLabel="מנהל Ankora" />, {
      wrapper: intlWrapper("he"),
    });
    expect(screen.getByRole("navigation", { name: "ניווט ראשי" })).toBeTruthy();
    expect(screen.getByText("חיפוש או פעולה")).toBeTruthy();
    expect(screen.getByText("התנתקות")).toBeTruthy();
  });
});

describe("dates in English (ADR 0006 decision 3)", () => {
  function When({ at }: { at: Date }) {
    const format = useFormatter();
    return <span data-testid="when">{format.dateTime(at, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>;
  }

  it("read day first and in 24 hours, the way the Hebrew screens do, not US style", () => {
    render(<When at={new Date("2026-03-04T15:05:00Z")} />, { wrapper: intlWrapper("en") });
    const text = screen.getByTestId("when").textContent ?? "";
    expect(text).toMatch(/^04\/03\/2026/);
    expect(text).toMatch(/17:05/);
  });
});
