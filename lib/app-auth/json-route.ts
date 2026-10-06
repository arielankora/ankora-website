import "server-only";
import type { User } from "@prisma/client";
import { requireUserOrThrow, UnauthorizedError } from "@/lib/app-auth/session";
import { isSameOriginJsonPost } from "@/lib/same-origin";

// The shared front door of the vault's JSON routes: same-origin JSON only,
// a live session, a parsed body, and `no-store` on every answer. Each
// route then does one thing.

const NO_STORE = { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" };

export function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: NO_STORE });
}

export async function openJsonRoute(
  req: Request,
): Promise<{ ok: true; user: User; body: Record<string, unknown> } | { ok: false; response: Response }> {
  if (!isSameOriginJsonPost(req)) return { ok: false, response: json({ error: "bad_request" }, 400) };
  let user: User;
  try {
    user = await requireUserOrThrow();
  } catch (err) {
    if (err instanceof UnauthorizedError) return { ok: false, response: json({ error: "unauthorized" }, 401) };
    throw err;
  }
  try {
    const body = (await req.json()) as unknown;
    if (!body || typeof body !== "object") return { ok: false, response: json({ error: "bad_request" }, 400) };
    return { ok: true, user, body: body as Record<string, unknown> };
  } catch {
    return { ok: false, response: json({ error: "bad_request" }, 400) };
  }
}
