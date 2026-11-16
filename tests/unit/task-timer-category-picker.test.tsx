// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { intlWrapper } from "../helpers/intl";

// 15.11.2026: a task opened from WhatsApp messages had no category, and
// its timer button only said "choose a category and try again". The
// button now opens a picker with a proposed category already chosen,
// saves the choice on the task and starts. The server actions are mocked:
// what is pinned here is the button's side.

const startTimer = vi.fn();
const suggest = vi.fn();
const update = vi.fn();
const toast = vi.fn();
vi.mock("@/app/(product)/app/(authenticated)/tasks/[id]/actions", () => ({
  startTimerForTaskAction: (...a: unknown[]) => startTimer(...a),
  stopTimerForTaskAction: vi.fn(),
  suggestTaskCategoryAction: (...a: unknown[]) => suggest(...a),
  updateTaskDetailAction: (...a: unknown[]) => update(...a),
}));
vi.mock("@/app/(product)/app/(authenticated)/timer/actions", () => ({ moveEntryIntoOpenBankAction: vi.fn() }));
vi.mock("@/components/app/toast/ToastProvider", () => ({ useToast: () => ({ showToast: toast }) }));
vi.mock("@/components/app/ActiveTimerProvider", () => ({ useActiveTimer: () => ({ announce: vi.fn() }) }));

import { TimerButton, type TaskDetailData } from "@/app/(product)/app/(authenticated)/tasks/[id]/TaskDetail";

const categories = [
  { id: "cat-a", name: "ייעוץ" },
  { id: "cat-b", name: "מסמכים" },
];

function task(categoryId: string | null): TaskDetailData {
  return { id: "t1", title: "מסמך של העסקת יועץ", categoryId } as TaskDetailData;
}

afterEach(() => {
  cleanup();
  startTimer.mockReset();
  suggest.mockReset();
  update.mockReset();
  toast.mockReset();
});

describe("timer button on a task with no category", () => {
  it("starts at once when the task has a category", async () => {
    startTimer.mockResolvedValue({ ok: true });
    render(<TimerButton task={task("cat-a")} categories={categories} activeTimers={[]} />, { wrapper: intlWrapper() });
    fireEvent.click(screen.getByRole("button", { name: "הפעלת טיימר" }));
    await waitFor(() => expect(startTimer).toHaveBeenCalledWith({ taskId: "t1" }));
    expect(screen.queryByTestId("timer-category-picker")).toBeNull();
    expect(suggest).not.toHaveBeenCalled();
  });

  it("opens the picker with the proposed category, saves it on the task, then starts", async () => {
    suggest.mockResolvedValue({ id: "cat-b", name: "מסמכים" });
    update.mockResolvedValue({ ok: true });
    startTimer.mockResolvedValue({ ok: true });
    render(<TimerButton task={task(null)} categories={categories} activeTimers={[]} />, { wrapper: intlWrapper() });

    fireEvent.click(screen.getByRole("button", { name: "הפעלת טיימר" }));
    expect(startTimer).not.toHaveBeenCalled();
    const picker = await screen.findByTestId("timer-category-picker");
    const select = picker.querySelector("select") as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("cat-b"));

    fireEvent.click(screen.getByRole("button", { name: "שמירה והפעלה" }));
    await waitFor(() => expect(startTimer).toHaveBeenCalledWith({ taskId: "t1" }));
    expect(update).toHaveBeenCalledWith({ taskId: "t1", categoryId: "cat-b" });
    expect(update.mock.invocationCallOrder[0]).toBeLessThan(startTimer.mock.invocationCallOrder[0]);
    expect(screen.queryByTestId("timer-category-picker")).toBeNull();
  });

  it("waits for a choice when nothing could be proposed, and keeps the person's own", async () => {
    suggest.mockResolvedValue(null);
    update.mockResolvedValue({ ok: true });
    startTimer.mockResolvedValue({ ok: true });
    render(<TimerButton task={task(null)} categories={categories} activeTimers={[]} />, { wrapper: intlWrapper() });

    fireEvent.click(screen.getByRole("button", { name: "הפעלת טיימר" }));
    const picker = await screen.findByTestId("timer-category-picker");
    const save = screen.getByRole("button", { name: "שמירה והפעלה" }) as HTMLButtonElement;
    await waitFor(() => expect(suggest).toHaveBeenCalled());
    expect(save.disabled).toBe(true);

    fireEvent.change(picker.querySelector("select") as HTMLSelectElement, { target: { value: "cat-a" } });
    fireEvent.click(save);
    await waitFor(() => expect(update).toHaveBeenCalledWith({ taskId: "t1", categoryId: "cat-a" }));
    await waitFor(() => expect(startTimer).toHaveBeenCalled());
  });

  it("does not start when the category could not be saved", async () => {
    suggest.mockResolvedValue({ id: "cat-a", name: "ייעוץ" });
    update.mockResolvedValue({ ok: false, error: "אין הרשאה" });
    render(<TimerButton task={task(null)} categories={categories} activeTimers={[]} />, { wrapper: intlWrapper() });

    fireEvent.click(screen.getByRole("button", { name: "הפעלת טיימר" }));
    const picker = await screen.findByTestId("timer-category-picker");
    await waitFor(() => expect((picker.querySelector("select") as HTMLSelectElement).value).toBe("cat-a"));
    fireEvent.click(screen.getByRole("button", { name: "שמירה והפעלה" }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ tone: "error", description: "אין הרשאה" })));
    expect(startTimer).not.toHaveBeenCalled();
    expect(screen.getByTestId("timer-category-picker")).toBeTruthy();
  });
});
