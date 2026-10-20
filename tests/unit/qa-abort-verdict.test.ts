import { describe, it, expect } from "vitest";
import { abortVerdict } from "../../qa/checks/e2e.mjs";

// "34 writes dropped while the browser was navigating away" is not a finding.
//
// It has been in the weekly report since 7.10 and has grown: 3, then 14 on
// run #399, then 34 on #514, most of them on the newest screen. It reads
// like a worsening fault, and after three weeks nobody could say whether it
// was one. claude/rsc-lost-ping-root-cause-2026-10-13.md had already
// established that ERR_ABORTED appears on successful writes too, because the
// browser cancels the response after the server has committed. So the number
// partly tracks how many writes the suite performs.
//
// What separates a cancelled response from a lost write is whether the test
// that issued it then proved the row was there. The fixture now prints that,
// and this is the judgement over it.

type Finding = { severity: string; title: string; detail: string };
const v = (out: unknown) => out as Finding | null;

const line = (opts: { writes: number; outcome?: string; retry?: number; test?: string }) =>
  `[abort-verdict] writes=${opts.writes} outcome=${opts.outcome ?? "as-expected"} retry=${opts.retry ?? 0}` +
  ` test=${JSON.stringify(opts.test ?? "a test")} on=POST /app/clients`;

describe("the aborted-write verdict", () => {
  it("says nothing when the run printed no verdict lines", () => {
    expect(abortVerdict("")).toBeNull();
    expect(abortVerdict("[abort] POST /app/clients 115ms net::ERR_ABORTED")).toBeNull();
    expect(abortVerdict(null)).toBeNull();
  });

  it("calls 34 aborted writes in passing tests what they are: nothing to do", () => {
    // Run #514's shape, compressed: lots of aborts, every test green first try.
    const out = v(abortVerdict([line({ writes: 6 }), line({ writes: 28 })].join("\n")));
    expect(out?.severity).toBe("info");
    expect(out?.title).toContain("34 aborted write(s), none in a test that failed");
  });

  it("raises the ones that belong to a test that did not end as expected", () => {
    const out = v(
      abortVerdict(
        [
          line({ writes: 30 }),
          line({ writes: 2, outcome: "failed", test: "a client is created and appears in the list" }),
        ].join("\n"),
      ),
    );
    expect(out?.severity).toBe("major");
    expect(out?.title).toContain("2 aborted write(s)");
    expect(out?.title).toContain("1 test(s)");
    // The failing test is named, so nobody has to go and look.
    expect(out?.detail).toContain("a client is created and appears in the list");
    // And the 30 harmless ones are not dragged into it.
    expect(out?.title).not.toContain("32");
  });

  it("does not let a retry pass as a clean run", () => {
    const out = v(abortVerdict([line({ writes: 4 }), line({ writes: 1, retry: 1 })].join("\n")));
    expect(out?.severity).toBe("minor");
    expect(out?.title).toContain("only on a retry");
  });

  it("reads lines that came through the web-server prefix", () => {
    // Playwright prefixes the app server's output; the raw log carries both.
    const out = v(abortVerdict(`[WebServer] ${line({ writes: 3 })}`));
    expect(out?.severity).toBe("info");
    expect(out?.title).toContain("3 aborted write(s)");
  });

  it("counts writes, not lines", () => {
    const out = v(abortVerdict([line({ writes: 10 }), line({ writes: 5 }), line({ writes: 1 })].join("\n")));
    expect(out?.title).toContain("16 aborted write(s)");
  });
});
