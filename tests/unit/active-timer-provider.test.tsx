// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { summariseActiveTimers, sameSummary } from "@/components/app/active-timer-summary";

// 19.10.2026, reported by Ariel with two screenshots: the timer was
// stopped in one tab, and the other tab's top bar pill and sidebar
// counter kept counting, even on the timer screen that said nothing was
// running. The layout read the start time once and App Router never read
// it again. These cases pin the replacement: the shell asks again when
// the state can have changed, and the server's answer wins.

const refresh = vi.fn();
const router = { refresh };
let pathname = "/app";
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => pathname,
}));

const summaryAction = vi.fn();
vi.mock("@/components/app/active-timer-actions", () => ({
  getActiveTimerSummaryAction: () => summaryAction(),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { ActiveTimerProvider, ShellTimerPill, useActiveTimer } from "@/components/app/ActiveTimerProvider";

/// A BroadcastChannel that delivers between instances in the same test,
/// as the browser does between tabs (never to the sender itself).
class FakeChannel {
  static all: FakeChannel[] = [];
  onmessage: ((e: { data: unknown }) => void) | null = null;
  constructor(public name: string) {
    FakeChannel.all.push(this);
  }
  postMessage(data: unknown) {
    for (const c of FakeChannel.all) if (c !== this && c.name === this.name) c.onmessage?.({ data });
  }
  close() {
    FakeChannel.all = FakeChannel.all.filter((c) => c !== this);
  }
}

const RUNNING = { startAt: "2026-10-19T09:00:00.000Z", extraCount: 0 };

function Announcer() {
  const { announce } = useActiveTimer();
  return (
    <button type="button" onClick={announce}>
      announce
    </button>
  );
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  refresh.mockReset();
  summaryAction.mockReset();
  pathname = "/app";
  FakeChannel.all = [];
  (globalThis as any).BroadcastChannel = FakeChannel;
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date("2026-10-19T10:00:00.000Z"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete (globalThis as any).BroadcastChannel;
});

describe("summariseActiveTimers", () => {
  it("is null with nothing running, and counts the oldest with +N", () => {
    expect(summariseActiveTimers([])).toBeNull();
    expect(
      summariseActiveTimers([
        { startAt: new Date("2026-10-19T09:30:00Z") },
        { startAt: new Date("2026-10-19T09:00:00Z") },
      ])
    ).toEqual({ startAt: "2026-10-19T09:00:00.000Z", extraCount: 1 });
  });

  it("compares by instant", () => {
    expect(sameSummary({ startAt: "2026-10-19T09:00:00Z", extraCount: 0 }, RUNNING)).toBe(true);
    expect(sameSummary(null, RUNNING)).toBe(false);
    expect(sameSummary(null, null)).toBe(true);
  });
});

describe("ActiveTimerProvider", () => {
  it("a stop announced in another tab clears this tab's pill and refreshes its page", async () => {
    // The other tab is just the channel; this tab still shows the timer.
    const otherTab = new FakeChannel("ankora-active-timer");
    render(
      <ActiveTimerProvider initial={RUNNING}>
        <ShellTimerPill />
      </ActiveTimerProvider>
    );
    expect(screen.getByText("01:00:00")).toBeTruthy();

    summaryAction.mockResolvedValue({ ok: true, summary: null });
    otherTab.postMessage({ type: "changed" });
    await flush();

    expect(screen.queryByText("01:00:00")).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("announcing from this tab tells the other tabs and corrects the shell without refreshing this page", async () => {
    const otherTab = new FakeChannel("ankora-active-timer");
    const heard = vi.fn();
    otherTab.onmessage = heard;
    summaryAction.mockResolvedValue({ ok: true, summary: null });
    render(
      <ActiveTimerProvider initial={RUNNING}>
        <ShellTimerPill />
        <Announcer />
      </ActiveTimerProvider>
    );

    await act(async () => screen.getByText("announce").click());
    await flush();

    expect(heard).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("01:00:00")).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("navigating re-checks, which is the case in the screenshot", async () => {
    summaryAction.mockResolvedValue({ ok: true, summary: null });
    const view = render(
      <ActiveTimerProvider initial={RUNNING}>
        <ShellTimerPill />
      </ActiveTimerProvider>
    );
    expect(summaryAction).not.toHaveBeenCalled();

    pathname = "/app/timer";
    view.rerender(
      <ActiveTimerProvider initial={RUNNING}>
        <ShellTimerPill />
      </ActiveTimerProvider>
    );
    await flush();

    expect(summaryAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("01:00:00")).toBeNull();
  });

  it("a minute's check picks up a timer started elsewhere (Claude, another device)", async () => {
    render(
      <ActiveTimerProvider initial={null}>
        <ShellTimerPill />
      </ActiveTimerProvider>
    );
    expect(screen.queryByRole("link")).toBeNull();

    summaryAction.mockResolvedValue({ ok: true, summary: RUNNING });
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    await flush();

    expect(screen.getByText("01:01:00")).toBeTruthy();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("an unchanged answer changes nothing and refreshes nothing", async () => {
    summaryAction.mockResolvedValue({ ok: true, summary: { ...RUNNING, startAt: "2026-10-19T09:00:00Z" } });
    render(
      <ActiveTimerProvider initial={RUNNING}>
        <ShellTimerPill />
      </ActiveTimerProvider>
    );
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await flush();

    expect(summaryAction).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByText("01:00:00")).toBeTruthy();
  });

  it("a lost session or a failed request keeps the pill as it is", async () => {
    summaryAction.mockResolvedValueOnce({ ok: false }).mockRejectedValueOnce(new Error("offline"));
    render(
      <ActiveTimerProvider initial={RUNNING}>
        <ShellTimerPill />
      </ActiveTimerProvider>
    );
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await flush();
    vi.setSystemTime(new Date("2026-10-19T10:00:05.000Z"));
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await flush();

    expect(summaryAction).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("link")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });
});
