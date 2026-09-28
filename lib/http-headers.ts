// The one place a download's filename becomes an HTTP header.
//
// 26.9.2026, level-3 hunt. Six call sites across two export routes built
// `Content-Disposition` by interpolating the client's name into
// `filename="..."`. Every Ankora client is named in Hebrew, and a header
// value is a ByteString: the moment a character above 255 reaches it the
// Response constructor throws
//
//   Cannot convert argument to a ByteString because the character at
//   index 38 has a value of 1491 which is greater than 255
//
// before a single byte of the file is sent. The caller sees a 500 from a
// button labelled "ייצוא". The same fault took down the time-entry export
// in September; it was fixed in the portal-document route and left
// standing in the two routes the product actually exports from.
//
// The fix is a header that carries the name twice, as RFC 6266 intends:
// an ASCII `filename` that any client can read, and an RFC 5987
// `filename*` that carries the real, Hebrew name. Nothing is stripped
// from the name the user sees - the previous code kept Hebrew in the
// header and that is precisely what broke it.
//
// Every Content-Disposition in the repo goes through here, and
// qa/checks/static.mjs fails the build if a new one does not. A rule that
// lives only in a comment is a rule that gets written again somewhere
// else.

/// Percent-encoding for RFC 5987's `attr-char` set. encodeURIComponent
/// leaves `! ' ( ) *` alone; `attr-char` does not include them, and a
/// bare `'` in particular would terminate the charset''value form.
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*!]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

/// A `Content-Disposition` value for an attachment, safe for any name in
/// any script. Pass the human filename, extension included.
export function attachmentDisposition(filename: string): string {
  // Control characters, quotes, backslashes and path separators are the
  // only things removed: they change what the header means, rather than
  // how it is spelled.
  const safe = filename.replace(/[\u0000-\u001f\u007f"\\/]+/g, "-").trim() || "download";
  // A fully Hebrew name collapses to dashes here. That is what the
  // fallback is for; the runs are collapsed so it stays readable.
  const ascii = safe.replace(/[^\x20-\x7e]+/g, "-").replace(/[-\s]{2,}/g, "-");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeRfc5987(safe)}`;
}
