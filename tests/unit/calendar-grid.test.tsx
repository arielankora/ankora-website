// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// The calendar's grid: what a drop does, and where links lead back to.
// The domain write itself is updateTask's, covered elsewhere; this is
// the screen's half.

const showToast = vi.fn();
vi.mock("@/components/app/toast/ToastProvider", () => ({ useToast: () => ({ showToast }) }));

const setTaskDueDateAction = vi.fn();
vi.mock("@/app/(product)/app/(authenticated)/calendar/actions", () => ({
  setTaskDueDateAction: (...args: unknown[]) => setTaskDueDateAction(...args),
}));

import { CalendarGrid } from "@/app/(product)/app/(authenticated)/calendar/CalendarGrid";
import { visibleDays } from "@/lib/calendar-keys";
import type { CalendarTask } from "@/lib/app-domain/calendar";

const days = visibleDays("week", "2026-10-19");

function task(id: string, dueKey: string | null, extra: Partial<CalendarTask> = {}): CalendarTask {
  return { id, title: `task ${id}`, clientName: "Client", dueKey, priority: "NORMAL", status: "OPEN", clientVisible: false, assigneeName: null, ...extra };
}

function renderGrid(tasks: CalendarTask[], drawer: "undated" | "overdue" | "closed" = "undated") {
  return render(
    <CalendarGrid
      view="week"
      anchor="2026-10-19"
      today="2026-10-19"
      days={days}
      tasks={tasks}
      dates={[{ id: "d1", title: "יום הולדת", clientName: "Client", dayKey: "2026-10-20" }]}
      drawer={drawer === "closed" ? undefined : drawer}
      drawerHrefs={{ undated: "/app/calendar?drawer=undated", overdue: "/app/calendar?drawer=overdue", close: "/app/calendar" }}
      undatedMore={false}
      overdueMore={false}
      query="view=week&date=2026-10-19"
      dayHrefs={Object.fromEntries(days.map((d) => [d, `/app/calendar?view=day&date=${d}`]))}
    />
  );
}

/// A drop the way the browser does it: one DataTransfer, carried from
/// dragstart to drop. jsdom has no DataTransfer, so a minimal one.
function dragTo(card: Element, target: Element) {
  const store: Record<string, string> = {};
  const dataTransfer = {
    setData: (k: string, v: string) => (store[k] = v),
    getData: (k: string) => store[k] ?? "",
    effectAllowed: "",
    dropEffect: "",
  };
  fireEvent.dragStart(card, { dataTransfer });
  fireEvent.dragOver(target, { dataTransfer });
  fireEvent.drop(target, { dataTransfer });
}

function cell(key: string) {
  return document.querySelector(`.md\\:block [data-day="${key}"]`)!;
}

beforeEach(() => {
  showToast.mockReset();
  setTaskDueDateAction.mockReset();
});
afterEach(cleanup);

describe("CalendarGrid", () => {
  it("draws a task on its due day, a date on its day, and an undated task in the panel", () => {
    renderGrid([task("t1", "2026-10-21"), task("t2", null)]);
    expect(cell("2026-10-21").querySelector('[data-calendar-task="t1"]')).not.toBeNull();
    expect(cell("2026-10-20").querySelector('[data-calendar-date="d1"]')).not.toBeNull();
    expect(screen.getByTestId("calendar-drawer").querySelector('[data-calendar-task="t2"]')).not.toBeNull();
  });

  it("links back to the calendar with the same query", () => {
    renderGrid([task("t1", "2026-10-21")]);
    const link = cell("2026-10-21").querySelector('[data-calendar-task="t1"] a') as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(`/app/tasks/t1?from=${encodeURIComponent("calendar:view=week&date=2026-10-19")}`);
    const date = cell("2026-10-20").querySelector('[data-calendar-date="d1"]') as HTMLAnchorElement;
    expect(date.getAttribute("href")).toContain("/app/important-dates/d1?from=calendar%3A");
  });

  it("dropping a task on another day saves that day and moves it", async () => {
    setTaskDueDateAction.mockResolvedValue({ ok: true });
    renderGrid([task("t1", "2026-10-21")]);
    await act(async () => dragTo(cell("2026-10-21").querySelector('[data-calendar-task="t1"]')!, cell("2026-10-23")));
    expect(setTaskDueDateAction).toHaveBeenCalledWith({ taskId: "t1", dueDate: "2026-10-23" });
    expect(cell("2026-10-23").querySelector('[data-calendar-task="t1"]')).not.toBeNull();
    expect(showToast.mock.calls.at(-1)?.[0]).toMatchObject({ tone: "success" });
    expect(typeof showToast.mock.calls.at(-1)?.[0].undo).toBe("function");
  });

  it("an undated task dropped on a day gets that day", async () => {
    setTaskDueDateAction.mockResolvedValue({ ok: true });
    renderGrid([task("t2", null)]);
    await act(async () => dragTo(screen.getByTestId("calendar-drawer").querySelector('[data-calendar-task="t2"]')!, cell("2026-10-22")));
    expect(setTaskDueDateAction).toHaveBeenCalledWith({ taskId: "t2", dueDate: "2026-10-22" });
    expect(cell("2026-10-22").querySelector('[data-calendar-task="t2"]')).not.toBeNull();
  });

  it("dropping on the panel removes the due date", async () => {
    setTaskDueDateAction.mockResolvedValue({ ok: true });
    renderGrid([task("t1", "2026-10-21")]);
    await act(async () => dragTo(cell("2026-10-21").querySelector('[data-calendar-task="t1"]')!, screen.getByTestId("calendar-drawer")));
    expect(setTaskDueDateAction).toHaveBeenCalledWith({ taskId: "t1", dueDate: null });
  });

  it("a refused save puts the task back and says why", async () => {
    setTaskDueDateAction.mockResolvedValue({ ok: false, error: "אין הרשאה" });
    renderGrid([task("t1", "2026-10-21")]);
    await act(async () => dragTo(cell("2026-10-21").querySelector('[data-calendar-task="t1"]')!, cell("2026-10-23")));
    expect(cell("2026-10-21").querySelector('[data-calendar-task="t1"]')).not.toBeNull();
    expect(showToast.mock.calls.at(-1)?.[0]).toMatchObject({ tone: "error", description: "אין הרשאה" });
  });

  it("a task the client sees asks before moving", async () => {
    setTaskDueDateAction.mockResolvedValue({ ok: true });
    renderGrid([task("t1", "2026-10-21", { clientVisible: true })]);
    await act(async () => dragTo(cell("2026-10-21").querySelector('[data-calendar-task="t1"]')!, cell("2026-10-23")));
    expect(setTaskDueDateAction).not.toHaveBeenCalled();
    const ask = showToast.mock.calls.at(-1)?.[0].ask;
    await act(async () => ask.onAnswer("move"));
    expect(setTaskDueDateAction).toHaveBeenCalledWith({ taskId: "t1", dueDate: "2026-10-23" });
  });

  it("the drawer is closed unless asked for, and the grid then has the width", () => {
    renderGrid([task("t2", null)], "closed");
    expect(screen.queryByTestId("calendar-drawer")).toBeNull();
  });

  it("the overdue list holds tasks due before today, oldest first, with their day", () => {
    renderGrid([task("late2", "2026-10-15"), task("late1", "2026-10-02"), task("ok", "2026-10-21")], "overdue");
    const rows = Array.from(screen.getByTestId("calendar-drawer").querySelectorAll("[data-calendar-task]")).map((el) => el.getAttribute("data-calendar-task"));
    expect(rows).toEqual(["late1", "late2"]);
    expect(screen.getByTestId("calendar-drawer").textContent).toContain("2.10");
  });

  it("an overdue task dragged from the drawer onto a day leaves the overdue list", async () => {
    setTaskDueDateAction.mockResolvedValue({ ok: true });
    renderGrid([task("late1", "2026-10-02")], "overdue");
    await act(async () => dragTo(screen.getByTestId("calendar-drawer").querySelector('[data-calendar-task="late1"]')!, cell("2026-10-22")));
    expect(setTaskDueDateAction).toHaveBeenCalledWith({ taskId: "late1", dueDate: "2026-10-22" });
    expect(screen.getByTestId("calendar-drawer").querySelector('[data-calendar-task="late1"]')).toBeNull();
    expect(cell("2026-10-22").querySelector('[data-calendar-task="late1"]')).not.toBeNull();
  });

  it("search narrows the drawer by title or client", () => {
    renderGrid([task("a", null, { title: "ביטוח רכב" }), task("b", null, { title: "דוח שבועי", clientName: "NUX" })]);
    fireEvent.change(screen.getByTestId("calendar-drawer-search"), { target: { value: "nux" } });
    const drawer = screen.getByTestId("calendar-drawer");
    expect(drawer.querySelector('[data-calendar-task="b"]')).not.toBeNull();
    expect(drawer.querySelector('[data-calendar-task="a"]')).toBeNull();
  });

  it("dropping on the same day does nothing", async () => {
    renderGrid([task("t1", "2026-10-21")]);
    await act(async () => dragTo(cell("2026-10-21").querySelector('[data-calendar-task="t1"]')!, cell("2026-10-21")));
    expect(setTaskDueDateAction).not.toHaveBeenCalled();
  });
});
