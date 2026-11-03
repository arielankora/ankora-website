import { describe, expect, it } from "vitest";
import {
  getsSubprocessorEmail,
  normalizeSubprocessorNotice,
  parseSubprocessorNotice,
  subprocessorNoticeChanged,
  SUBPROCESSOR_NOTICE_SOURCE_REQUIRED,
} from "@/lib/subprocessor-notice";

// Client.subprocessorNotice (3.11.2026): P8 step 8 emails a client whose
// contract commits Ankora to tell it about a new sub-processor, and a client
// nobody checked yet. Only an explicit "no" is left to the website.

describe("normalizeSubprocessorNotice", () => {
  it("requires a source for a yes or a no", () => {
    expect(() => normalizeSubprocessorNotice({ notice: "COMMITTED", source: "  " })).toThrow(
      SUBPROCESSOR_NOTICE_SOURCE_REQUIRED
    );
    expect(() => normalizeSubprocessorNotice({ notice: "NOT_COMMITTED" })).toThrow(SUBPROCESSOR_NOTICE_SOURCE_REQUIRED);
  });

  it("keeps the trimmed source and the document", () => {
    expect(normalizeSubprocessorNotice({ notice: "COMMITTED", source: " הסכם, סעיף 9 ", documentId: "doc1" })).toEqual({
      subprocessorNotice: "COMMITTED",
      subprocessorNoticeSource: "הסכם, סעיף 9",
      subprocessorNoticeDocumentId: "doc1",
    });
  });

  it("clears the source and the document when the answer goes back to unchecked", () => {
    expect(normalizeSubprocessorNotice({ notice: "UNCHECKED", source: "ישן", documentId: "doc1" })).toEqual({
      subprocessorNotice: "UNCHECKED",
      subprocessorNoticeSource: null,
      subprocessorNoticeDocumentId: null,
    });
  });
});

describe("parseSubprocessorNotice", () => {
  it("accepts the three values and nothing else", () => {
    expect(parseSubprocessorNotice("COMMITTED")).toBe("COMMITTED");
    expect(parseSubprocessorNotice("UNCHECKED")).toBe("UNCHECKED");
    expect(parseSubprocessorNotice("yes")).toBeUndefined();
    expect(parseSubprocessorNotice(null)).toBeUndefined();
  });
});

describe("subprocessorNoticeChanged", () => {
  const base = { subprocessorNotice: "COMMITTED" as const, subprocessorNoticeSource: "א", subprocessorNoticeDocumentId: null };
  it("is false for the same answer and true when any part moves", () => {
    expect(subprocessorNoticeChanged(base, { ...base })).toBe(false);
    expect(subprocessorNoticeChanged(base, { ...base, subprocessorNoticeSource: "ב" })).toBe(true);
    expect(subprocessorNoticeChanged(base, { ...base, subprocessorNoticeDocumentId: "d" })).toBe(true);
  });
});

describe("getsSubprocessorEmail", () => {
  it("emails committed and unchecked clients, not those without a commitment", () => {
    expect(getsSubprocessorEmail("COMMITTED")).toBe(true);
    expect(getsSubprocessorEmail("UNCHECKED")).toBe(true);
    expect(getsSubprocessorEmail("NOT_COMMITTED")).toBe(false);
  });
});
