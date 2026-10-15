import { describe, expect, it, vi } from "vitest";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

// The signed copy of an employee agreement. lib/pdf.test.ts already pins
// Hebrew glyph order for the shared drawing helper; this checks that the
// agreement document builds at all, across pages, with its signature
// block, from the real versioned text.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { renderAgreementPdf } = await import("@/lib/agreement-pdf");
const { visualSegments } = await import("@/lib/pdf");
const { contentHash, currentAgreement, loadAgreementText } = await import("@/lib/agreements");

async function render() {
  const agreement = currentAgreement("CONFIDENTIALITY");
  const text = loadAgreementText(agreement);
  return renderAgreementPdf({
    title: agreement.title,
    version: agreement.version,
    text,
    signedName: "דנה כהן",
    email: "dana@ankora.co.il",
    signedAt: new Date("2026-10-15T09:30:00Z"),
    ip: "203.0.113.7",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36",
    channel: "APP",
    contentHash: contentHash(text),
  });
}

describe("renderAgreementPdf", () => {
  it("returns a non-empty PDF", async () => {
    const buf = await render();
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });

  it("is A4, runs to more than one page, and carries the hash and IP", async () => {
    const buf = await render();
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    expect(doc.numPages).toBeGreaterThan(1);

    const first = await doc.getPage(1);
    const [, , w, h] = first.view;
    expect(Math.round(w)).toBe(595);
    expect(Math.round(h)).toBe(842);

    let all = "";
    for (let i = 1; i <= doc.numPages; i++) {
      const content = await (await doc.getPage(i)).getTextContent();
      all += content.items.map((it) => ("str" in it ? it.str : "")).join("");
    }
    expect(all).toContain("203.0.113.7");
    // The hash may be wrapped across lines; its first characters are not.
    const hash = contentHash(loadAgreementText(currentAgreement("CONFIDENTIALITY")));
    expect(all).toContain(hash.slice(0, 16));
  });
});

// The prose bidi pass in lib/pdf.ts. Expected values are worked out by
// hand, left to right as painted, with each Hebrew segment in logical
// order because fontkit reverses Hebrew text itself (see lib/pdf.ts).
describe("visualSegments", () => {
  const texts = (s: string) => visualSegments(s).map((seg) => seg.text);

  it("keeps a version string's number after its Hebrew word", () => {
    expect(texts("סודיות-1.0")).toEqual(["1.0-", "סודיות"]);
  });

  it("closes Hebrew in brackets on the correct side", () => {
    expect(texts("(שעון ישראל)")).toEqual(["(", "ישראל", " ", "שעון", ")"]);
  });

  it("puts a section number on the right of its sentence", () => {
    // The trailing dot sits between a digit and Hebrew, so it takes the
    // paragraph direction and is painted to the left of the number.
    expect(texts("1.1. אנקורה")).toEqual(["אנקורה", " .1.1"]);
  });

  it("leaves a Latin-only line in reading order", () => {
    expect(texts("203.0.113.7")).toEqual(["203.0.113.7"]);
  });
});
