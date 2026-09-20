// Phase 15 (MCP OAuth, docs/adr/0005): where to send the user after a
// successful sign-in.
//
// This used to be the constant "/app". That was fine while the login page
// was only ever reached directly, but the OAuth consent screen sends an
// unauthenticated user here mid-flow - and landing them on the dashboard
// instead of back at the consent screen breaks the connection silently:
// they sign in, see their normal home page, and nothing ever tells them
// the authorization they started was abandoned.
//
// Honouring a caller-supplied destination on a LOGIN page is also the
// classic open-redirect phishing aid ("sign in to the real site, get
// bounced to my copy"), so the validation below is deliberately strict
// rather than clever:
//
//   - a relative path, OR an absolute URL on this app's OWN origin. The
//     absolute form is not optional: Auth.js's middleware intercepts the
//     unauthenticated request to the consent screen before the page's own
//     redirect runs, and it writes callbackUrl as a full URL. A first cut
//     accepted only relative paths and would therefore have sent every
//     real sign-in to the dashboard - the exact silent break this function
//     exists to prevent, arriving from the other direction. Found by
//     following the redirect chain on a deployment, not by reasoning.
//   - must start with "/app/", so it can only ever land inside the product
//   - "//evil.com" and "/\evil.com" are refused explicitly, because a
//     browser reads both as protocol-relative URLs to another host
//
// That last check is, as written, unreachable: neither form can start with
// "/app/", so the prefix test above already rejects them. Mutation testing
// proved it - deleting the line failed no test. It stays anyway, as the
// layer that still holds if the prefix test is ever loosened (to allow a
// second product path, say), which is exactly the change most likely to
// reintroduce the hole. Documented as redundant rather than removed or,
// worse, left looking load-bearing.
//
// Anything that fails falls back to "/app" rather than erroring: a bad
// callbackUrl is not worth blocking a legitimate sign-in over.
export function safeCallbackUrl(
  value: FormDataEntryValue | null,
  /// The app's own origin, when the caller can determine it. Required to
  /// accept the ABSOLUTE form - see the note above about Auth.js.
  selfOrigin?: string
): string {
  const raw = typeof value === "string" ? value : "";
  if (!raw) return "/app";
  if (/[\x00-\x1f]/.test(raw)) return "/app";

  // Absolute form. Auth.js's middleware produces this, so refusing it
  // outright would break the very flow this function exists to protect.
  // The origin is compared as a PARSED origin, never as a string prefix:
  // "https://ankora.co.il.evil.com/app/x" starts with the real origin's
  // characters and is a different site.
  if (selfOrigin) {
    try {
      const target = new URL(raw);
      if (target.origin !== new URL(selfOrigin).origin) return "/app";
      const path = target.pathname + target.search;
      return path.startsWith("/app/") ? path : "/app";
    } catch {
      // Not absolute - fall through to the relative form below.
    }
  }

  // Relative form.
  if (!raw.startsWith("/app/")) return "/app";
  // Protocol-relative forms, which are paths to the regex but hosts to a
  // browser. Backslash is included because browsers normalise it to "/".
  if (raw.startsWith("//") || raw.startsWith("/\\")) return "/app";
  return raw;
}
