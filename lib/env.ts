import "server-only";

// The two questions this codebase used to ask by reading process.env
// directly, in eight places, with no test anywhere standing on the
// production side of any of them.
//
// 22.9.2026: that is how a new employee's invite went out pointing at a
// host she could not open. The branch that chose the address ran only in
// production, and production was the one environment the suite never
// occupied. Every test ran where the condition was false, so the suite
// exercised the revealing, permissive half of every one of these forks
// and asserted nothing about the other half.
//
// They are deliberately two functions, because they are two different
// questions and conflating them is part of what produced the bug.

/// "Is this a production build?"
///
/// Vercel sets NODE_ENV=production for preview deployments too, and that
/// is correct: a preview must be exactly as tight-lipped as production.
/// This governs SECRECY - raw tokens, dev-only links, cookie Secure flags.
export function isProductionBuild(): boolean {
  return process.env.NODE_ENV === "production";
}

/// "Am I THE production deployment?"
///
/// True only for the real thing, false on every preview. This governs
/// IDENTITY - which address we put our name to when we speak to someone
/// outside. A preview answering this with `true` would email links that
/// operate on production data; production answering `false` is the
/// failure of 22.9.2026.
export function isProductionDeployment(): boolean {
  return process.env.VERCEL_ENV === "production";
}

/// Only meaningful for local tooling - Prisma's query log. Neither of the
/// two questions above.
export function isDevelopment(): boolean {
  return process.env.NODE_ENV === "development";
}

/// A value that may be handed back only outside a production build: raw
/// tokens and ready-made links that exist so a flow can be walked
/// end-to-end locally without a mail provider.
///
/// A function rather than a comparison at each call site, so a caller
/// cannot express the condition backwards. There is one place to get
/// this wrong, and it is tested on both sides.
export function devOnly<T>(value: T): T | undefined {
  return isProductionBuild() ? undefined : value;
}
