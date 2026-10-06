import "server-only";

// For JSON route handlers that act on the session cookie. Server actions
// get Next's own origin check; route handlers get nothing, so the two
// vault routes ask for it here.
//
// Two conditions, either of which a cross-site page cannot meet: the body
// must be declared JSON (a plain HTML form cannot send that without a
// CORS preflight, which this app never answers), and the Origin header,
// which browsers always send on a POST, must name this host.
export function isSameOriginJsonPost(req: Request): boolean {
  const type = req.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) return false;
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
