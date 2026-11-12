// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";

// ADR 0006, "Content in English": staff read client content in English
// through the browser's own translator, and that is machine translation.
// What is marked "בלי AI" must tell the browser not to translate it.

const aiExcludedClientIds = vi.fn<(ids: Iterable<string>) => Promise<Set<string>>>();
vi.mock("@/lib/app-domain/ai-exclusion-db", () => ({
  aiExcludedClientIds: (ids: Iterable<string>) => aiExcludedClientIds(ids),
}));

import { NoMachineTranslation, noTranslateProps } from "@/components/app/NoMachineTranslation";
import ClientLayout from "@/app/(product)/app/(authenticated)/clients/[clientId]/layout";

afterEach(() => {
  cleanup();
  aiExcludedClientIds.mockReset();
});

const googleMeta = () => document.head.querySelectorAll('meta[name="google"][content="notranslate"]');

describe("NoMachineTranslation", () => {
  it("when active, wraps the content in translate=no and tells Chrome not to offer translating the page", () => {
    const { container, getByText } = render(
      <NoMachineTranslation active>
        <p>תוכן של לקוח</p>
      </NoMachineTranslation>
    );
    const wrapper = getByText("תוכן של לקוח").closest('[translate="no"]');
    expect(wrapper).not.toBeNull();
    // No box of its own: the page's layout is unchanged.
    expect(wrapper?.className).toBe("contents");
    expect(container.contains(wrapper)).toBe(true);
    // React 19 hoists the <meta> into <head>.
    expect(googleMeta()).toHaveLength(1);
  });

  it("when not active, renders the children as they are and nothing else", () => {
    const { container } = render(
      <NoMachineTranslation active={false}>
        <p>תוכן</p>
      </NoMachineTranslation>
    );
    expect(container.innerHTML).toBe("<p>תוכן</p>");
    expect(container.querySelector("[translate]")).toBeNull();
    expect(googleMeta()).toHaveLength(0);
  });
});

describe("noTranslateProps", () => {
  it("is translate=no for an excluded item and nothing otherwise", () => {
    expect(noTranslateProps(true)).toEqual({ translate: "no" });
    expect(noTranslateProps(false)).toEqual({});
    expect(noTranslateProps(undefined)).toEqual({});
    expect(noTranslateProps(null)).toEqual({});
  });
});

describe("the client's pages (clients/[clientId]/layout)", () => {
  it("are kept from the translator when the client is marked", async () => {
    aiExcludedClientIds.mockResolvedValue(new Set(["c1"]));
    const tree = await ClientLayout({ children: <p>תיק</p>, params: Promise.resolve({ clientId: "c1" }) });
    const { getByText } = render(tree);
    expect(aiExcludedClientIds).toHaveBeenCalledWith(["c1"]);
    expect(getByText("תיק").closest('[translate="no"]')).not.toBeNull();
    expect(googleMeta()).toHaveLength(1);
  });

  it("are left alone when it is not", async () => {
    aiExcludedClientIds.mockResolvedValue(new Set());
    const tree = await ClientLayout({ children: <p>תיק</p>, params: Promise.resolve({ clientId: "c2" }) });
    const { container } = render(tree);
    expect(container.querySelector("[translate]")).toBeNull();
    expect(googleMeta()).toHaveLength(0);
  });
});

// The task page and the portal are server pages with a long list of data
// behind them; what matters is that the wrapper is fed by the same rule
// the rest of "בלי AI" uses, so that is what is pinned here.
describe("pages of one task or one client's portal", () => {
  const source = (p: string) => readFileSync(path.join(__dirname, "../..", p), "utf8");

  it("the task page wraps its content, active when taskAiExclusion says the task, its parent or its client is marked", () => {
    const page = source("app/(product)/app/(authenticated)/tasks/[id]/page.tsx");
    expect(page).toMatch(/const aiExcluded = taskAiExclusion\(task\) !== null;/);
    expect(page).toMatch(/<NoMachineTranslation active=\{aiExcluded\}>/);
  });

  it("the portal wraps every screen when the signed-in client user's client is marked", () => {
    const layout = source("app/(product)/app/(authenticated)/portal/layout.tsx");
    expect(layout).toMatch(/<NoMachineTranslation active=\{!!ctx\?\.client\.aiExcluded\}>/);
  });

  it("an important date's page wraps its content when its client is marked", () => {
    const page = source("app/(product)/app/(authenticated)/important-dates/[id]/page.tsx");
    expect(page).toMatch(/<NoMachineTranslation active=\{date\.client\.aiExcluded\}>/);
  });
});
