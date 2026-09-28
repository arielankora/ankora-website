import { describe, expect, it } from "vitest";
import { attachmentDisposition } from "@/lib/http-headers";

// 26.9.2026, level-3 hunt. The reports and time-entry exports put the
// client's name straight into `Content-Disposition`, and every Ankora
// client is named in Hebrew. A header value is a ByteString, so the
// Response constructor threw before a byte of the file was sent and the
// export button returned 500 for every client-filtered download, in all
// three formats.
//
// The assertions below are deliberately about the Response constructor
// and not about the string. Checking the shape of the header would only
// prove it agrees with how I happened to write it; constructing the
// Response is the exact operation that used to throw.

const HEBREW = "hours_by_client_משפחת כהן_2026-09-26.csv";

function headerIsSendable(value: string): boolean {
  new Response("x", { headers: { "Content-Disposition": value } });
  return true;
}

describe("attachmentDisposition()", () => {
  it("survives a Hebrew filename, the regression this exists for", () => {
    expect(headerIsSendable(attachmentDisposition(HEBREW))).toBe(true);
  });

  it("is what the old code did, and the old code threw", () => {
    // Guards the premise. If a future runtime stops rejecting non-ASCII
    // header values, this test turning red is the signal that the whole
    // helper can be reconsidered, rather than the helper quietly
    // outliving its reason.
    expect(() => headerIsSendable(`attachment; filename="${HEBREW}"`)).toThrow();
  });

  it("carries the real name in filename*, percent-encoded as UTF-8", () => {
    const value = attachmentDisposition(HEBREW);
    expect(value).toContain(`filename*=UTF-8''${encodeURIComponent(HEBREW)}`);
  });

  it("leaves an ASCII name untouched in the plain filename", () => {
    const value = attachmentDisposition("time-entries_all-clients_2026-09-26.xlsx");
    expect(value).toContain('filename="time-entries_all-clients_2026-09-26.xlsx"');
  });

  it("strips quotes, backslashes and path separators", () => {
    // A quote would end the quoted-string early and let the rest of the
    // name be read as header parameters.
    const value = attachmentDisposition('a"b\\c/d.csv');
    expect(value).toContain('filename="a-b-c-d.csv"');
    expect(headerIsSendable(value)).toBe(true);
  });

  it("refuses to emit an empty filename", () => {
    expect(attachmentDisposition("   ")).toContain('filename="download"');
  });

  it("escapes the RFC 5987 characters encodeURIComponent leaves alone", () => {
    // A bare apostrophe would close the charset''value form.
    const value = attachmentDisposition("o'brien (final)*.csv");
    expect(value).not.toMatch(/filename\*=UTF-8''.*['()*]/);
    expect(headerIsSendable(value)).toBe(true);
  });
});
