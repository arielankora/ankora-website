import { describe, expect, it } from "vitest";
import {
  carriedListQuery,
  listQueryOf,
  taskHref,
  tasksListHref,
} from "@/app/(product)/app/(authenticated)/tasks/list-query";

// Ariel, 7.10.2026: the way back from a task leads to the list as it was
// filtered, not to its defaults. `from` comes off the address bar, so it
// is input: these pin that it can only ever lead back under /app/tasks.
describe("task list query, there and back", () => {
  it("round-trips the list's own filters", () => {
    const query = listQueryOf({ clientId: "c1", status: "DONE", mine: "0", q: "אינסטלטור", view: "board" });
    const href = taskHref("t1", query);
    const from = new URL(href, "https://x").searchParams.get("from");
    expect(tasksListHref(from)).toBe(`/app/tasks?${query}`);
    expect(new URLSearchParams(tasksListHref(from).split("?")[1]).get("q")).toBe("אינסטלטור");
  });

  it("links plainly when the list is on its defaults", () => {
    expect(taskHref("t1", listQueryOf({}))).toBe("/app/tasks/t1");
    expect(tasksListHref(undefined)).toBe("/app/tasks");
    expect(tasksListHref("")).toBe("/app/tasks");
  });

  it("drops keys the list does not read", () => {
    expect(tasksListHref("clientId=c1&openDrawer=new-task&next=https://evil.example")).toBe("/app/tasks?clientId=c1");
  });

  it("cannot be turned into a link to anywhere else", () => {
    for (const from of ["//evil.example", "https://evil.example", "/../admin", "javascript:alert(1)"]) {
      expect(tasksListHref(from)).toBe("/app/tasks");
    }
  });

  it("refuses an absurdly long value rather than carrying it", () => {
    expect(tasksListHref(`q=${"a".repeat(500)}&clientId=c1`)).toBe("/app/tasks?clientId=c1");
  });

  it("hands the same list on from a task to its steps", () => {
    expect(carriedListQuery("clientId=c1&junk=1")).toBe("clientId=c1");
    expect(taskHref("s1", carriedListQuery("clientId=c1"))).toBe("/app/tasks/s1?from=clientId%3Dc1");
  });
});
