import { describe, expect, it } from "vitest";
import { restoreOrder } from "../../scripts/restore-from-dump.mjs";

// The restore script's table order (3.11.2026). A foreign-key cycle used
// to stop the restore outright: clients.subprocessorNoticeDocumentId ->
// client_documents -> tasks -> clients.

type Edge = { child: string; parent: string; column: string; nullable: boolean };
const order = restoreOrder as unknown as (tables: string[], edges: Edge[]) => { order: string[]; deferred: { table: string; column: string }[] };

describe("restoreOrder", () => {
  it("puts parents before children", () => {
    const r = order(["tasks", "clients"], [{ child: "tasks", parent: "clients", column: "clientId", nullable: false }]);
    expect(r).toEqual({ order: ["clients", "tasks"], deferred: [] });
  });

  it("sets aside the one nullable key that closes a cycle, and fills it in last", () => {
    const edges: Edge[] = [
      { child: "clients", parent: "client_documents", column: "subprocessorNoticeDocumentId", nullable: true },
      { child: "client_documents", parent: "tasks", column: "taskId", nullable: true },
      { child: "client_documents", parent: "clients", column: "clientId", nullable: false },
      { child: "tasks", parent: "clients", column: "clientId", nullable: false },
    ];
    const r = order(["clients", "client_documents", "tasks"], edges);
    expect(r.deferred).toEqual([{ table: "clients", column: "subprocessorNoticeDocumentId" }]);
    expect(r.order).toEqual(["clients", "tasks", "client_documents"]);
  });

  it("still stops on a cycle of required keys, naming the tables", () => {
    const edges: Edge[] = [
      { child: "a", parent: "b", column: "bId", nullable: false },
      { child: "b", parent: "a", column: "aId", nullable: false },
    ];
    expect(() => order(["a", "b"], edges)).toThrow(/Foreign-key cycle among: a, b/);
  });

  it("ignores a table's key to itself (tasks.parentId), ordered row by row instead", () => {
    const r = order(["tasks"], [{ child: "tasks", parent: "tasks", column: "parentId", nullable: true }]);
    expect(r).toEqual({ order: ["tasks"], deferred: [] });
  });
});
