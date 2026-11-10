import { describe, expect, it } from "vitest";
import { DEFAULT_TASKS_VIEW, resolveTasksView } from "@/lib/tasks-view";

describe("resolveTasksView", () => {
  it("opens on the board when nothing says otherwise", () => {
    expect(DEFAULT_TASKS_VIEW).toBe("board");
    expect(resolveTasksView(undefined, undefined)).toBe("board");
  });

  it("brings back the last choice", () => {
    expect(resolveTasksView(undefined, "list")).toBe("list");
    expect(resolveTasksView(undefined, "board")).toBe("board");
  });

  it("lets the address win over what was remembered", () => {
    expect(resolveTasksView("list", "board")).toBe("list");
    expect(resolveTasksView("board", "list")).toBe("board");
  });

  it("ignores values it does not know", () => {
    expect(resolveTasksView("grid", "kanban")).toBe("board");
    expect(resolveTasksView("", "list")).toBe("list");
    expect(resolveTasksView(["list"], undefined)).toBe("board");
  });
});
