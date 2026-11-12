// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ADVANCE_TIMER_LABELS, advanceTimerNotice, type AdvanceTimerOutcome } from "@/lib/advance-timer";
import { intlWrapper } from "../helpers/intl";

// "קדם עם קלוד והפעל טיימר" (Ariel, 3.11.2026): about a minute of billable
// time was lost on every task between pasting the prompt and Claude's
// first card. The second button copies the same prompt and starts the
// timer from Ankora at the click. These cases pin the order (copy first,
// never undone by the timer), the outcomes, and that the old button
// starts no timer.

const startAction = vi.fn();
const recordAction = vi.fn();
vi.mock("@/app/(product)/app/(authenticated)/tasks/[id]/actions", () => ({
  startTimerFromAdvanceAction: (input: unknown) => startAction(input),
  recordAdvancePromptCopiedAction: (input: unknown) => recordAction(input),
}));
const announce = vi.fn();
vi.mock("@/components/app/ActiveTimerProvider", () => ({
  useActiveTimer: () => ({ summary: null, announce }),
}));

import { AdvanceWithClaude } from "@/app/(product)/app/(authenticated)/tasks/[id]/AdvanceWithClaude";

const writeText = vi.fn();

beforeEach(() => {
  startAction.mockReset();
  recordAction.mockReset().mockResolvedValue(undefined);
  announce.mockReset();
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});
afterEach(cleanup);

async function click(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
}

describe("advanceTimerNotice()", () => {
  it("says for every outcome whether a timer now runs", () => {
    const outcomes: AdvanceTimerOutcome[] = ["started", "running_on_client", "other_client", "no_category", "error"];
    for (const o of outcomes) expect(advanceTimerNotice(o)).toMatch(/טיימר/);
    expect(advanceTimerNotice("started")).toBe("הטיימר הופעל על המשימה.");
    expect(advanceTimerNotice("other_client")).toMatch(/קלוד ישאל/);
    expect(advanceTimerNotice("no_category")).toMatch(/קלוד ישאל/);
    expect(advanceTimerNotice("error", "אין הרשאה")).toContain("אין הרשאה");
  });

  it("has no long dash in any line the screen shows", () => {
    const lines = [
      ...Object.values(ADVANCE_TIMER_LABELS),
      ...(["started", "running_on_client", "other_client", "no_category", "error"] as const).map((o) => advanceTimerNotice(o, "x")),
    ];
    for (const l of lines) expect(l).not.toMatch(/[–—]/);
  });
});

describe("AdvanceWithClaude with a timer", () => {
  it("copies the prompt first, then starts the timer on the task and refreshes the timer bar", async () => {
    const order: string[] = [];
    writeText.mockImplementation(async () => void order.push("copy"));
    startAction.mockImplementation(async () => {
      order.push("timer");
      return { outcome: "started" };
    });
    render(<AdvanceWithClaude taskId="t1" prompt="PROMPT" hasPlan={false} />, { wrapper: intlWrapper() });
    await click(ADVANCE_TIMER_LABELS.plan);
    expect(order).toEqual(["copy", "timer"]);
    expect(writeText).toHaveBeenCalledWith("PROMPT");
    expect(startAction).toHaveBeenCalledWith({ taskId: "t1" });
    expect(announce).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("advance-timer-notice").textContent).toBe("הטיימר הופעל על המשימה.");
  });

  it("does not start a parallel timer: another client's timer leaves the question to Claude", async () => {
    startAction.mockResolvedValue({ outcome: "other_client" });
    render(<AdvanceWithClaude taskId="t1" prompt="PROMPT" hasPlan={false} />, { wrapper: intlWrapper() });
    await click(ADVANCE_TIMER_LABELS.plan);
    expect(writeText).toHaveBeenCalled();
    expect(announce).not.toHaveBeenCalled();
    expect(screen.getByTestId("advance-timer-notice").textContent).toMatch(/לקוח אחר/);
  });

  it("still starts the timer when the browser refuses the copy, and shows the manual box", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    startAction.mockResolvedValue({ outcome: "started" });
    render(<AdvanceWithClaude taskId="t1" prompt="PROMPT" hasPlan={false} />, { wrapper: intlWrapper() });
    await click(ADVANCE_TIMER_LABELS.plan);
    expect(screen.getByLabelText("הפרומט לקלוד")).toBeTruthy();
    expect(startAction).toHaveBeenCalled();
  });

  it("reports a failed action without throwing, and the prompt stays copied", async () => {
    startAction.mockRejectedValue(new Error("network"));
    render(<AdvanceWithClaude taskId="t1" prompt="PROMPT" hasPlan={false} />, { wrapper: intlWrapper() });
    await click(ADVANCE_TIMER_LABELS.plan);
    expect(recordAction).toHaveBeenCalled();
    expect(screen.getByTestId("advance-timer-notice").textContent).toMatch(/לא הופעל/);
  });

  it("the plain button copies and starts nothing", async () => {
    render(<AdvanceWithClaude taskId="t1" prompt="PROMPT" hasPlan={false} />, { wrapper: intlWrapper() });
    await click("קדם עם קלוד");
    expect(writeText).toHaveBeenCalled();
    expect(startAction).not.toHaveBeenCalled();
    expect(screen.queryByTestId("advance-timer-notice")).toBeNull();
  });

  it("is offered on a closed task's summary too", async () => {
    startAction.mockResolvedValue({ outcome: "running_on_client" });
    render(<AdvanceWithClaude taskId="t1" prompt="PROMPT" hasPlan={false} mode="lessons" />, { wrapper: intlWrapper() });
    await click(ADVANCE_TIMER_LABELS.lessons);
    expect(startAction).toHaveBeenCalledWith({ taskId: "t1" });
    expect(screen.getByTestId("advance-timer-notice").textContent).toMatch(/כבר רץ/);
  });
});
