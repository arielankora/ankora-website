// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { intlWrapper } from "../helpers/intl";

// The timer's task picker (22.11.2026). It used to offer only the tasks the
// client sees, so for a client with internal work only, no field appeared
// at all. It now offers every open task on the chosen client, marks the
// ones the client sees, and fills the category from the chosen task, as
// the manual entry on "הזמן שלי" does. The stop keeps its stage question
// for tasks the client sees only.

const startAction = vi.fn();
const stopAction = vi.fn();
const stageAction = vi.fn();
vi.mock("@/app/(product)/app/(authenticated)/timer/actions", () => ({
  startTimerAction: (input: unknown) => startAction(input),
  stopTimerAction: (input: unknown) => stopAction(input),
  reopenTimerAction: vi.fn(),
  moveEntryIntoOpenBankAction: vi.fn(),
  discardActiveTimerAction: vi.fn(),
  updateActiveTimerNoteAction: vi.fn(),
  recordPromiseStageAction: (input: unknown) => stageAction(input),
}));
const showToast = vi.fn();
vi.mock("@/components/app/toast/ToastProvider", () => ({
  useToast: () => ({ showToast }),
}));
vi.mock("@/components/app/ActiveTimerProvider", () => ({
  useActiveTimer: () => ({ summary: null, announce: vi.fn() }),
}));

import { TimerWidget, type OpenTask, type ActiveTimer } from "@/app/(product)/app/(authenticated)/timer/TimerWidget";

const clients = [
  { id: "c1", name: "לקוח א" },
  { id: "c2", name: "לקוח ב" },
];
const categories = [
  { id: "cat-global", name: "כללי", clientId: null },
  { id: "cat-c1", name: "ייעודית", clientId: "c1" },
];
const tasks: OpenTask[] = [
  { id: "t-internal", clientId: "c1", label: "משימה פנימית", categoryId: "cat-c1", clientVisible: false },
  { id: "t-visible", clientId: "c1", label: "הבטחה גלויה", categoryId: null, clientVisible: true },
  { id: "t-other", clientId: "c2", label: "של לקוח אחר", categoryId: null, clientVisible: false },
];

function renderWidget(opts: { openTasks?: OpenTask[]; activeTimers?: ActiveTimer[] } = {}) {
  return render(
    <TimerWidget
      activeTimers={opts.activeTimers ?? []}
      clients={clients}
      categories={categories}
      recent={[]}
      todayEntries={[]}
      openTasks={opts.openTasks ?? tasks}
    />,
    { wrapper: intlWrapper() }
  );
}

function pickClient(id: string) {
  fireEvent.change(screen.getByRole("combobox", { name: "לקוח" }), { target: { value: id } });
}

beforeEach(() => {
  startAction.mockReset();
  stopAction.mockReset();
  stageAction.mockReset();
  showToast.mockReset();
});
afterEach(cleanup);

describe("the timer's task picker", () => {
  it("offers every open task on the chosen client, internal ones too, and marks the ones the client sees", () => {
    renderWidget();
    expect(screen.queryByRole("combobox", { name: "משימה" })).toBeNull();

    pickClient("c1");
    const picker = screen.getByRole("combobox", { name: "משימה" });
    const labels = Array.from(picker.querySelectorAll("option")).map((o) => o.textContent);
    expect(labels).toEqual(["לא משויך", "משימה פנימית", "הבטחה גלויה (הלקוח רואה)"]);
  });

  it("is absent for a client with no open task", () => {
    renderWidget({ openTasks: tasks.filter((t) => t.clientId !== "c2") });
    pickClient("c2");
    expect(screen.queryByRole("combobox", { name: "משימה" })).toBeNull();
  });

  it("fills the category from the chosen task, and leaves it when the task has none", () => {
    renderWidget();
    pickClient("c1");
    const category = screen.getByRole("combobox", { name: "קטגוריה" }) as HTMLSelectElement;
    const picker = screen.getByRole("combobox", { name: "משימה" });

    fireEvent.change(picker, { target: { value: "t-internal" } });
    expect(category.value).toBe("cat-c1");

    fireEvent.change(category, { target: { value: "cat-global" } });
    fireEvent.change(picker, { target: { value: "t-visible" } });
    expect(category.value, "a task without a category does not clear the choice").toBe("cat-global");
  });

  it("starts the timer on the chosen internal task", async () => {
    startAction.mockResolvedValue({
      ok: true,
      entry: { id: "e1", startAt: new Date().toISOString(), clientId: "c1", categoryId: "cat-c1", note: null, taskId: "t-internal" },
    });
    renderWidget();
    pickClient("c1");
    fireEvent.change(screen.getByRole("combobox", { name: "משימה" }), { target: { value: "t-internal" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "התחלת טיימר" }));
    });
    expect(startAction).toHaveBeenCalledWith(expect.objectContaining({ clientId: "c1", categoryId: "cat-c1", taskId: "t-internal" }));
  });
});

describe("stopping a timer on a task", () => {
  const running = (taskId: string | null): ActiveTimer => ({
    id: "e1",
    startAt: new Date(Date.now() - 60_000).toISOString(),
    clientId: "c1",
    categoryId: "cat-c1",
    note: null,
    taskId,
  });

  async function stop() {
    stopAction.mockResolvedValue({ ok: true });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /עצירה ושמירה/ }));
    });
  }

  it("on an internal task: no stage question, the task is named, and no note is needed", async () => {
    renderWidget({ activeTimers: [running("t-internal")] });
    await stop();
    expect(stopAction).toHaveBeenCalledWith(expect.objectContaining({ taskId: "t-internal" }));
    const toast = showToast.mock.calls.at(-1)?.[0];
    expect(toast.ask, "an internal task has nothing to tell the client").toBeUndefined();
    expect(toast.description).toContain("משימה פנימית");
    expect(toast.undo).toBeTypeOf("function");
  });

  it("on a task the client sees: asks where it stands", async () => {
    renderWidget({ activeTimers: [running("t-visible")] });
    await stop();
    const toast = showToast.mock.calls.at(-1)?.[0];
    expect(toast.ask).toBeDefined();
    expect(toast.description).toBe("הבטחה גלויה");
  });

  it("with no task chosen: attaches the client's single promise, never a lone internal task", async () => {
    renderWidget({ activeTimers: [running(null)] });
    await stop();
    expect(stopAction).toHaveBeenCalledWith(expect.objectContaining({ taskId: "t-visible" }));

    cleanup();
    stopAction.mockReset();
    renderWidget({ activeTimers: [running(null)], openTasks: tasks.filter((t) => t.id !== "t-visible") });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "עבודה כללית" } });
    await stop();
    expect(stopAction).toHaveBeenCalledWith(expect.objectContaining({ taskId: null }));
  });
});
