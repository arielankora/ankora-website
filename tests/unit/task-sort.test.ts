import { describe, expect, it } from "vitest";
import { nextSort, parseSort, sortParam, sortRows } from "@/app/(product)/app/(authenticated)/tasks/task-sort";
import { listQueryOf, tasksListHref } from "@/app/(product)/app/(authenticated)/tasks/list-query";
import type { ListRow } from "@/app/(product)/app/(authenticated)/tasks/TaskListProvider";

function row(id: string, patch: Partial<ListRow>): ListRow {
  return {
    id,
    title: id,
    clientName: "לקוח",
    categoryName: null,
    dueDate: null,
    status: "OPEN",
    priority: "NORMAL",
    assignedToId: null,
    assignedToName: null,
    supervisorId: null,
    supervisorName: null,
    clientVisible: false,
    supplierName: null,
    supplierExperience: null,
    clientTitle: null,
    blockedOn: null,
    blockedSince: null,
    clientOutcome: null,
    stepsTotal: 0,
    stepsDone: 0,
    ...patch,
  } as ListRow;
}

const ids = (rows: ListRow[]) => rows.map((r) => r.id);

describe("task list sort", () => {
  it("reads and writes the address form, and ignores anything else", () => {
    expect(parseSort("due")).toEqual({ key: "due", desc: false });
    expect(parseSort("-status")).toEqual({ key: "status", desc: true });
    expect(parseSort("priority")).toBeNull();
    expect(parseSort(undefined)).toBeNull();
    expect(sortParam({ key: "client", desc: true })).toBe("-client");
    expect(sortParam(null)).toBeNull();
  });

  it("cycles up, down and back to the server's order", () => {
    const up = nextSort(null, "due");
    expect(up).toEqual({ key: "due", desc: false });
    const down = nextSort(up, "due");
    expect(down).toEqual({ key: "due", desc: true });
    expect(nextSort(down, "due")).toBeNull();
    expect(nextSort(down, "client")).toEqual({ key: "client", desc: false });
  });

  it("keeps the server's order with no sort", () => {
    const rows = [row("b", {}), row("a", {})];
    expect(sortRows(rows, null)).toBe(rows);
  });

  it("sorts by date, undated last in both directions", () => {
    const rows = [
      row("none", {}),
      row("late", { dueDate: "2026-12-31T00:00:00.000Z" }),
      row("early", { dueDate: "2026-11-05T00:00:00.000Z" }),
    ];
    expect(ids(sortRows(rows, { key: "due", desc: false }))).toEqual(["early", "late", "none"]);
    expect(ids(sortRows(rows, { key: "due", desc: true }))).toEqual(["late", "early", "none"]);
  });

  it("sorts statuses in working order, not alphabetically", () => {
    const rows = [row("done", { status: "DONE" }), row("open", { status: "OPEN" }), row("wait", { status: "PENDING_APPROVAL" })];
    expect(ids(sortRows(rows, { key: "status", desc: false }))).toEqual(["open", "wait", "done"]);
  });

  // Hebrew first, then Latin, the way the "he" collation orders them,
  // and case does not split "NUX" from "nux".
  it("sorts names in Hebrew order and keeps ties in the server's order", () => {
    const rows = [
      row("nux-1", { clientName: "NUX" }),
      row("bet", { clientName: "בית" }),
      row("alef", { clientName: "אלף" }),
      row("nux-2", { clientName: "nux" }),
    ];
    expect(ids(sortRows(rows, { key: "client", desc: false }))).toEqual(["alef", "bet", "nux-1", "nux-2"]);
  });

  it("puts tasks with nobody assigned last", () => {
    const rows = [row("nobody", {}), row("hadas", { assignedToName: "Hadas" }), row("ariel", { assignedToName: "Ariel" })];
    expect(ids(sortRows(rows, { key: "assignee", desc: true }))).toEqual(["hadas", "ariel", "nobody"]);
  });

  it("travels with the way back from a task", () => {
    expect(listQueryOf({ status: "DONE", sort: "-due" })).toBe("status=DONE&sort=-due");
    expect(tasksListHref("sort=client")).toBe("/app/tasks?sort=client");
  });
});
