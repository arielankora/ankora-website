import { describe, expect, it } from "vitest";
import { toMcpToolError, toolFailure, toolJson, toolText } from "@/lib/mcp/errors";

// Phase 13 (MCP server, docs/adr/0005). These assertions are about
// *behaviour of the message*, not its wording: an MCP error is read by a
// model that then decides whether to retry, so the two properties that
// matter are (a) a recoverable error tells it which call to make next and
// (b) an unrecognised error leaks nothing about the database.

/// The domain layer's error classes all set `name` in their constructor
/// (see lib/app-domain/time-entries.ts). lib/mcp/errors.ts maps on that
/// name rather than `instanceof` so it stays importable without Prisma -
/// these stand-ins reproduce exactly what it keys on.
function namedError(name: string, message = "boom"): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

describe("toMcpToolError()", () => {
  it("marks a permission failure as not recoverable and says not to retry", () => {
    const result = toMcpToolError(namedError("ForbiddenError"));
    expect(result.recoverable).toBe(false);
    expect(result.message).toMatch(/do not retry/i);
  });

  it("points an active-timer collision at the tool that resolves it", () => {
    const result = toMcpToolError(namedError("ActiveTimerExistsError"));
    expect(result.recoverable).toBe(true);
    expect(result.message).toContain("get_active_timer");
    expect(result.message).toContain("stop_timer");
  });

  it("treats the 48-hour edit window as a dead end, not something to retry", () => {
    const result = toMcpToolError(namedError("EditWindowExpiredError"));
    expect(result.recoverable).toBe(false);
    expect(result.message).toMatch(/admin/i);
  });

  it("points an overlap at the tool that shows the conflicting entries", () => {
    const result = toMcpToolError(namedError("OverlapError"));
    expect(result.recoverable).toBe(true);
    expect(result.message).toContain("list_my_time_entries");
  });

  it("asks the user for the missing reason on a backdated entry", () => {
    const result = toMcpToolError(namedError("BackdateReasonRequiredError"));
    expect(result.recoverable).toBe(true);
    expect(result.message).toMatch(/reason/i);
  });

  it("does not echo an unrecognised error's own message", () => {
    // The guard that matters: a raw Prisma failure can carry a table name,
    // a constraint, or a row fragment, and tool output goes straight to a
    // model that may repeat it to the user or into a chat log.
    const leaky = namedError(
      "PrismaClientKnownRequestError",
      'Unique constraint failed on the fields: (`tokenHash`) in table "mcp_access_tokens"'
    );
    const result = toMcpToolError(leaky);
    expect(result.message).not.toContain("mcp_access_tokens");
    expect(result.message).not.toContain("tokenHash");
    expect(result.message).not.toContain("Unique constraint");
    expect(result.recoverable).toBe(false);
  });

  it("handles a non-Error throw without crashing", () => {
    expect(toMcpToolError("just a string").recoverable).toBe(false);
    expect(toMcpToolError(null).recoverable).toBe(false);
    expect(toMcpToolError(undefined).message).toBeTruthy();
  });

  it("never returns an empty message", () => {
    for (const name of ["ForbiddenError", "OverlapError", "SomethingUnknown"]) {
      expect(toMcpToolError(namedError(name)).message.length).toBeGreaterThan(20);
    }
  });
});

describe("result shaping", () => {
  it("flags a failure so the client treats it as one", () => {
    const result = toolFailure(namedError("ForbiddenError"));
    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe("text");
  });

  it("serialises JSON results readably", () => {
    const result = toolJson({ count: 1, clients: [{ name: "Globex" }] });
    expect(result.content[0].text).toContain("\n");
    expect(JSON.parse(result.content[0].text)).toEqual({ count: 1, clients: [{ name: "Globex" }] });
  });

  it("passes prose through untouched", () => {
    const result = toolText("No timer is currently running for this user.");
    expect(result.content[0].text).toBe("No timer is currently running for this user.");
  });
});
