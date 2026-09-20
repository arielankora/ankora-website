import { describe, expect, it } from "vitest";
import {
  elapsedMinutes,
  serializeClient,
  serializeTeamTimeEntry,
  serializeTimeEntry,
  toMinutes,
  type TimeEntryLike,
} from "@/lib/mcp/serialize";

// Phase 13 (MCP server, docs/adr/0005).

function entry(overrides: Partial<TimeEntryLike> = {}): TimeEntryLike {
  return {
    id: "te1",
    startAt: new Date("2026-03-02T07:00:00Z"),
    endAt: new Date("2026-03-02T09:45:00Z"),
    actualSeconds: 9900,
    billableSeconds: 10800,
    note: "onboarding call",
    source: "TIMER",
    isManual: false,
    isEdited: false,
    client: { name: "Globex" },
    category: { name: "ייעוץ" },
    task: { title: "Kickoff" },
    ...overrides,
  };
}

describe("toMinutes()", () => {
  it("converts and rounds to whole minutes", () => {
    expect(toMinutes(9900)).toBe(165);
    expect(toMinutes(90)).toBe(2);
    expect(toMinutes(29)).toBe(0);
  });

  it("passes null and undefined through as null", () => {
    expect(toMinutes(null)).toBeNull();
    expect(toMinutes(undefined)).toBeNull();
  });

  it("keeps zero as zero rather than collapsing it to null", () => {
    expect(toMinutes(0)).toBe(0);
  });
});

describe("serializeTimeEntry()", () => {
  it("emits instants as ISO 8601 rather than a local wall-clock string", () => {
    const result = serializeTimeEntry(entry());
    expect(result.startAt).toBe("2026-03-02T07:00:00.000Z");
    expect(result.endAt).toBe("2026-03-02T09:45:00.000Z");
  });

  it("emits minutes as numbers, not the screen's display strings", () => {
    const result = serializeTimeEntry(entry());
    expect(result.actualMinutes).toBe(165);
    expect(result.billableMinutes).toBe(180);
    // lib/time-entry-format.ts renders "2:45" for a human table; a model
    // doing arithmetic must not receive that.
    expect(String(result.actualMinutes)).not.toContain(":");
  });

  it("marks a running entry and leaves its end null", () => {
    const result = serializeTimeEntry(entry({ endAt: null, actualSeconds: null, billableSeconds: null }));
    expect(result.running).toBe(true);
    expect(result.endAt).toBeNull();
    expect(result.actualMinutes).toBeNull();
  });

  it("tolerates missing relations", () => {
    const result = serializeTimeEntry(entry({ client: null, category: null, task: null }));
    expect(result.client).toBeNull();
    expect(result.category).toBeNull();
    expect(result.task).toBeNull();
  });

  it("emits exactly the documented field set and nothing more", () => {
    // The rule this guards: never spread a Prisma row into tool output, or
    // a future column joins the payload silently.
    expect(Object.keys(serializeTimeEntry(entry())).sort()).toEqual(
      [
        "actualMinutes",
        "billableMinutes",
        "category",
        "client",
        "createdVia",
        "edited",
        "endAt",
        "id",
        "note",
        "running",
        "source",
        "startAt",
        "task",
      ].sort()
    );
  });

  it("does not carry a userId into the payload", () => {
    // Identity comes from the token, never from tool output, so there is
    // nothing here for a model to try reusing as someone else's handle.
    const serialized = serializeTimeEntry(entry() as TimeEntryLike & { userId?: string });
    expect(Object.keys(serialized)).not.toContain("userId");
  });
});

describe("elapsedMinutes()", () => {
  it("measures from the start instant to now", () => {
    const start = new Date("2026-03-02T07:00:00Z");
    const now = new Date("2026-03-02T08:30:00Z");
    expect(elapsedMinutes(start, now)).toBe(90);
  });

  it("never reports a negative duration for a clock-skewed start", () => {
    const start = new Date("2026-03-02T08:00:00Z");
    const now = new Date("2026-03-02T07:59:00Z");
    expect(elapsedMinutes(start, now)).toBe(0);
  });
});

describe("serializeClient()", () => {
  it("emits id, name and status and nothing else", () => {
    const result = serializeClient({ id: "c1", name: "Globex", status: "ACTIVE" });
    expect(result).toEqual({ id: "c1", name: "Globex", status: "ACTIVE" });
  });
});

// ---------------------------------------------------------------- Phase 14

describe("createdVia", () => {
  it("passes MCP through, so an entry Claude made is identifiable", () => {
    expect(serializeTimeEntry(entry({ createdVia: "MCP" })).createdVia).toBe("MCP");
  });

  it("defaults an unset value to APP, matching the migration's backfill", () => {
    // Rows created before Phase 14 have no origin of their own; the column
    // defaults to APP in the database and must read the same way here.
    expect(serializeTimeEntry(entry({ createdVia: null })).createdVia).toBe("APP");
    expect(serializeTimeEntry(entry({ createdVia: undefined })).createdVia).toBe("APP");
  });
});

describe("serializeTeamTimeEntry()", () => {
  it("adds the employee name", () => {
    const result = serializeTeamTimeEntry(entry({ user: { name: "הדס" } }));
    expect(result.employee).toBe("הדס");
    expect(result.client).toBe("Globex");
  });

  it("tolerates a missing user relation", () => {
    expect(serializeTeamTimeEntry(entry({ user: null })).employee).toBeNull();
  });

  it("never lets the employee name reach the self-scoped payload", () => {
    // The two payloads are separate functions precisely so this cannot be
    // undone by editing one object literal.
    const self = serializeTimeEntry(entry({ user: { name: "הדס" } })) as Record<string, unknown>;
    expect(Object.keys(self)).not.toContain("employee");
    expect(Object.values(self)).not.toContain("הדס");
  });
});
