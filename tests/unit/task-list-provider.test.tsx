// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { useEffect } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { TaskListProvider, useTaskList, type ListRow } from "@/app/(product)/app/(authenticated)/tasks/TaskListProvider";

// The list holds its own rows so that a created task does not have to be
// fetched back. That is the end of a three-week problem, and the
// properties worth pinning are the ones that make it an end rather than
// a workaround:
//
//   - the row appears without anything being fetched,
//   - the server still wins, so this cannot drift into a second source
//     of truth,
//   - and a row that does not belong in the current filter is not shown,
//     because a row the next render would remove is a flicker.

// Not automatic in this repo's vitest setup, and without it every test
// below renders on top of the last one's DOM.
afterEach(() => cleanup());

function row(over: Partial<ListRow> = {}): ListRow {
  return {
    id: "t1",
    title: "משימה",
    clientName: "לקוח א",
    categoryName: null,
    dueDate: null,
    status: "OPEN",
    priority: "NORMAL",
    assignedToName: null,
    clientVisible: false,
    supplierName: null,
    supplierExperience: null,
    clientTitle: null,
    waitingOnClient: false,
    clientOutcome: null,
    ...over,
  };
}

/// Calls addCreated once, the way the create form does when the action
/// comes back with the row it wrote.
function Creator({ task }: { task: ListRow }) {
  const { addCreated } = useTaskList();
  useEffect(() => {
    addCreated(task);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/// Reads the merged rows the way the real view does: out of the context,
/// not out of a prop.
///
/// The first version of this file used a render prop, and every case
/// below passed. It could not have failed: jsdom has no server/client
/// boundary, so nothing here notices that a function cannot be passed
/// from a Server Component to a Client one. The product noticed, on
/// every render of the tasks screen. A unit test cannot check that
/// boundary, and this comment is here so the next person does not
/// believe it did.
function Rows() {
  const { rows } = useTaskList();
  return (
    <ul>
      {rows.map((r) => (
        <li key={r.id}>{r.title}</li>
      ))}
    </ul>
  );
}

function renderList(
  rows: ListRow[],
  filters: { status?: string; clientId?: string; clientName?: string } = {},
  created?: ListRow
) {
  return render(
    <TaskListProvider rows={rows} filters={filters}>
      {created && <Creator task={created} />}
      <Rows />
    </TaskListProvider>
  );
}

describe("a created task appears without being fetched", () => {
  it("shows it immediately", () => {
    renderList([row({ id: "server", title: "ישנה" })], {}, row({ id: "new", title: "חדשה" }));
    expect(screen.getByText("חדשה")).toBeDefined();
    expect(screen.getByText("ישנה")).toBeDefined();
  });

  it("puts it at the top, whatever the server's order says", () => {
    // Somebody who just created a task is looking for confirmation that
    // it exists, not for where it ranks.
    renderList([row({ id: "server", title: "ישנה" })], {}, row({ id: "new", title: "חדשה" }));
    const titles = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(titles[0]).toBe("חדשה");
  });
});

describe("the server still wins", () => {
  it("stops holding the row the moment the server sends it", () => {
    // The property that keeps this from becoming a second source of
    // truth: what is held locally is exactly what the server has not had
    // a chance to say yet, and not a moment longer.
    const created = row({ id: "new", title: "חדשה" });
    const { rerender } = renderList([row({ id: "server", title: "ישנה" })], {}, created);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);

    act(() => {
      rerender(
        <TaskListProvider rows={[created, row({ id: "server", title: "ישנה" })]} filters={{}}>
          <Rows />
        </TaskListProvider>
      );
    });

    // Two rows, not three: no duplicate, and the one on screen is the
    // server's.
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});

describe("a row that does not belong is not shown", () => {
  it("drops it when a status filter excludes it", () => {
    // A new task is OPEN. Creating one while "הושלמו" is selected would
    // put a row on screen that the next render correctly removes, which
    // is a flicker rather than a feature.
    renderList([], { status: "DONE" }, row({ id: "new", title: "חדשה" }));
    expect(screen.queryByText("חדשה")).toBeNull();
  });

  it("drops it when it belongs to a different client than the one filtered", () => {
    renderList(
      [],
      { clientId: "c2", clientName: "לקוח ב" },
      row({ id: "new", title: "חדשה", clientName: "לקוח א" })
    );
    expect(screen.queryByText("חדשה")).toBeNull();
  });

  it("keeps it when the filter is the client it was created on", () => {
    renderList(
      [],
      { clientId: "c1", clientName: "לקוח א" },
      row({ id: "new", title: "חדשה", clientName: "לקוח א" })
    );
    expect(screen.getByText("חדשה")).toBeDefined();
  });
});
