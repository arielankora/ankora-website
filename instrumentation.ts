import type { Instrumentation } from "next";

/// Every server error nothing else caught (27.11.2026, silent failures plan).
///
/// Next calls this for an error thrown while rendering a page, in a route
/// handler or a server action, that no code of ours handled. Before, those
/// reached only Vercel's log. Each becomes a system issue per route, so the
/// failures nobody knew to look for are the ones that now get seen.
///
/// Node only: the issue table is written through Prisma, which the edge
/// runtime (middleware) cannot load.
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportIssue } = await import("@/lib/system-issues");
  const digest = typeof err === "object" && err !== null && "digest" in err ? String((err as { digest?: unknown }).digest) : null;
  await reportIssue({
    area: "server",
    key: `${context.routeType}:${context.routePath}`,
    title: `שגיאת שרת לא צפויה ב-${context.routePath}`,
    error: err,
    severity: "CRITICAL",
  });
  if (digest) console.error(`[issue] server error digest ${digest} on ${request.method} ${context.routePath}`);
};
