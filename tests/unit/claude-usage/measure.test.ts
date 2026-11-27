import { describe, expect, it, vi } from "vitest";
import { argsHash, measureResult, withToolMeasurement, type ToolCallMeasure } from "@/lib/claude-usage/measure";
import { isPromptKind, PROMPT_KINDS } from "@/lib/claude-usage/prompt-kinds";
import { toolFailure } from "@/lib/mcp/errors";
import { DomainError } from "@/lib/domain-error";

// Claude usage measurement (17.11.2026). What matters here is that the
// measurement is accurate and invisible: it records the size of what went
// back to Claude, and it never changes or delays a tool's answer, even
// when the measurement itself fails.

type Handler = (args: unknown, ctx: unknown) => Promise<unknown>;

function fakeServer() {
  const handlers = new Map<string, Handler>();
  return {
    handlers,
    registerTool: (name: string, _config: unknown, handler: Handler) => {
      handlers.set(name, handler);
    },
    other: function (this: unknown) {
      return this;
    },
  };
}

const ctxFor = (id: string) => ({ http: { authInfo: { extra: { user: { id } } } } });

describe("measureResult", () => {
  it("counts UTF-8 bytes and characters of every text part", () => {
    const m = measureResult({ content: [{ type: "text", text: "abc" }, { type: "text", text: "שלום" }] });
    expect(m).toEqual({ ok: true, resultBytes: 3 + 8, resultChars: 3 + 4, imageCount: 0, truncated: false });
  });

  it("counts an image by its decoded size", () => {
    const m = measureResult({ content: [{ type: "image", data: "A".repeat(400) }] });
    expect(m.imageCount).toBe(1);
    expect(m.resultBytes).toBe(300);
    expect(m.resultChars).toBe(0);
  });

  it("marks isError as not ok", () => {
    expect(measureResult({ content: [{ type: "text", text: "no" }], isError: true }).ok).toBe(false);
  });

  it("notices a tool that said it cut its answer short, pretty-printed or compact", () => {
    expect(measureResult({ content: [{ type: "text", text: '{\n  "truncated": true\n}' }] }).truncated).toBe(true);
    expect(measureResult({ content: [{ type: "text", text: '{"truncated":true}' }] }).truncated).toBe(true);
    expect(measureResult({ content: [{ type: "text", text: '{"truncated":false}' }] }).truncated).toBe(false);
  });

  it("treats a missing result as an empty one", () => {
    expect(measureResult(undefined)).toEqual({ ok: true, resultBytes: 0, resultChars: 0, imageCount: 0, truncated: false });
  });
});

describe("argsHash", () => {
  it("is the same whatever the key order, at any depth", () => {
    expect(argsHash({ a: 1, b: { c: 2, d: 3 } })).toBe(argsHash({ b: { d: 3, c: 2 }, a: 1 }));
  });

  it("differs when a value differs, and is 16 hex characters", () => {
    const h = argsHash({ client: "NUX" });
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(h).not.toBe(argsHash({ client: "RIMED" }));
  });

  it("does not carry the argument itself", () => {
    expect(argsHash({ client: "NUX" })).not.toContain("NUX");
  });

  it("handles no arguments", () => {
    expect(argsHash(undefined)).toBe(argsHash({}));
  });
});

describe("withToolMeasurement", () => {
  it("records each call once, with who, which tool, size and timing, and returns the answer untouched", async () => {
    const server = fakeServer();
    const sink = vi.fn();
    let clock = 1000;
    const measured = withToolMeasurement(server, sink, () => clock);
    const answer = { content: [{ type: "text", text: "hello" }] };
    measured.registerTool("get_task", {}, async () => {
      clock += 42;
      return answer;
    });

    const result = await server.handlers.get("get_task")!({ task: "x" }, ctxFor("u1"));

    expect(result).toBe(answer);
    expect(sink).toHaveBeenCalledOnce();
    expect(sink.mock.calls[0][0]).toEqual<ToolCallMeasure>({
      userId: "u1",
      tool: "get_task",
      ok: true,
      resultBytes: 5,
      resultChars: 5,
      imageCount: 0,
      truncated: false,
      argsHash: argsHash({ task: "x" }),
      durationMs: 42,
    });
  });

  it("records a refusal as not ok", async () => {
    const server = fakeServer();
    const sink = vi.fn();
    withToolMeasurement(server, sink).registerTool("t", {}, async () => ({ content: [{ type: "text", text: "no" }], isError: true }));
    await server.handlers.get("t")!({}, ctxFor("u1"));
    expect(sink.mock.calls[0][0].ok).toBe(false);
  });

  it("records a handler that throws as not ok, and rethrows the same error", async () => {
    const server = fakeServer();
    const sink = vi.fn();
    const boom = new Error("boom");
    withToolMeasurement(server, sink).registerTool("t", {}, async () => {
      throw boom;
    });
    await expect(server.handlers.get("t")!({}, ctxFor("u1"))).rejects.toBe(boom);
    expect(sink.mock.calls[0][0]).toMatchObject({ tool: "t", ok: false, resultBytes: 0 });
  });

  it("never lets a failing measurement reach the user", async () => {
    const server = fakeServer();
    const answer = { content: [{ type: "text", text: "ok" }] };
    withToolMeasurement(server, () => {
      throw new Error("database down");
    }).registerTool("t", {}, async () => answer);
    await expect(server.handlers.get("t")!({}, ctxFor("u1"))).resolves.toBe(answer);
  });

  it("does not wait for the sink", async () => {
    const server = fakeServer();
    const answer = { content: [{ type: "text", text: "ok" }] };
    withToolMeasurement(server, () => new Promise(() => {})).registerTool("t", {}, async () => answer);
    await expect(server.handlers.get("t")!({}, ctxFor("u1"))).resolves.toBe(answer);
  });

  it("records no user when the call carries none", async () => {
    const server = fakeServer();
    const sink = vi.fn();
    withToolMeasurement(server, sink).registerTool("t", {}, async () => ({ content: [] }));
    await server.handlers.get("t")!({}, {});
    expect(sink.mock.calls[0][0].userId).toBeNull();
  });

  it("passes everything else through to the real server", () => {
    const server = fakeServer();
    const measured = withToolMeasurement(server, vi.fn());
    expect(measured.other()).toBe(server);
  });
});

// 27.11.2026, silent failures plan: an unexpected error inside a tool is a
// system issue with the tool's name; a refusal of the domain is not.
describe("withToolMeasurement reports unexpected tool errors", () => {
  it("reports an unexpected error once, with the tool's name, and returns the same answer", async () => {
    const server = fakeServer();
    const onUnexpected = vi.fn(async () => {});
    const boom = new Error("prisma exploded");
    withToolMeasurement(server, vi.fn(), Date.now, onUnexpected).registerTool("create_task", {}, async () => toolFailure(boom));
    const result = (await server.handlers.get("create_task")!({}, ctxFor("u1"))) as { isError?: boolean };
    expect(result.isError).toBe(true);
    expect(onUnexpected).toHaveBeenCalledExactlyOnceWith("create_task", boom);
  });

  it("does not report a refusal of the domain", async () => {
    const server = fakeServer();
    const onUnexpected = vi.fn(async () => {});
    withToolMeasurement(server, vi.fn(), Date.now, onUnexpected).registerTool("update_task", {}, async () =>
      toolFailure(new DomainError("tasks.needsApproval", "המשימה הזו דורשת אישור.")),
    );
    await server.handlers.get("update_task")!({}, ctxFor("u1"));
    expect(onUnexpected).not.toHaveBeenCalled();
  });

  it("returns the answer even when reporting throws", async () => {
    const server = fakeServer();
    withToolMeasurement(server, vi.fn(), Date.now, async () => {
      throw new Error("db down");
    }).registerTool("t", {}, async () => toolFailure(new Error("x")));
    const result = (await server.handlers.get("t")!({}, ctxFor("u1"))) as { isError?: boolean };
    expect(result.isError).toBe(true);
  });
});

describe("prompt kinds", () => {
  it("accepts the known kinds only", () => {
    for (const kind of PROMPT_KINDS) expect(isPromptKind(kind)).toBe(true);
    expect(isPromptKind("something_else")).toBe(false);
    expect(isPromptKind(undefined)).toBe(false);
  });
});
