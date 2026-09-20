// Phase 13 (MCP server, docs/adr/0005): resolving a name the model said
// to an id the domain layer wants.
//
// This is the single highest-risk piece of the whole server. Every
// lib/app-domain function takes cuids (`clientId`, `categoryId`), and a
// language model does not have them. If a tool takes a raw id as a
// required argument the model will eventually invent one, and in a write
// tool that means time booked against the wrong client - silent, and
// plausible enough that nobody notices for a month.
//
// So no write tool exposes a raw id as its only handle. They take a name,
// resolve it against the rows the ACTOR may actually see (always the
// output of listAccessibleClients(actor), never a global list), and refuse
// to guess when the answer is not unique.
//
// Pure by design - no `server-only`, no Prisma - so
// tests/unit/mcp/resolve.test.ts can cover the matching rules directly.

export type NamedEntity = { id: string; name: string };

export type ResolveResult<T extends NamedEntity> =
  | { status: "ok"; match: T }
  | { status: "none"; query: string }
  | { status: "ambiguous"; query: string; candidates: T[] };

/// Normalises for comparison. Hebrew has no case, but the same client is
/// written with different spacing ("אנקורה  בע\"מ"), with directional
/// marks pasted in from a browser, and in either Unicode normalisation
/// form depending on the keyboard that typed it - so fold all three.
export function normalizeName(value: string): string {
  return value
    .normalize("NFC")
    // Strip bidi control characters (RLM/LRM/RLE/PDF and friends). They are
    // invisible, they routinely ride along on Hebrew text copied out of a
    // browser, and they would otherwise make an exact match silently fail.
    .replace(/[‎‏‪-‮⁦-⁩]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/// Resolves `query` against `candidates`, which MUST already be scoped to
/// what the actor is allowed to see.
///
/// Precedence is deliberate:
///   1. An exact (normalised) match wins outright, even if it is also a
///      prefix of other names. Without this rule a client literally named
///      "אנקורה" could never be selected while "אנקורה 360" exists.
///   2. Otherwise, prefix matches.
///   3. Otherwise, substring matches.
/// Each tier is considered on its own: two substring matches are ambiguous
/// even if one of them also happens to be longer. Ranking by length here
/// would be a guess, and guessing is the thing this module exists to
/// prevent.
export function resolveByName<T extends NamedEntity>(query: string, candidates: T[]): ResolveResult<T> {
  const q = normalizeName(query);
  if (!q) return { status: "none", query };

  const exact = candidates.filter((c) => normalizeName(c.name) === q);
  if (exact.length === 1) return { status: "ok", match: exact[0] };
  if (exact.length > 1) return { status: "ambiguous", query, candidates: exact };

  const prefix = candidates.filter((c) => normalizeName(c.name).startsWith(q));
  if (prefix.length === 1) return { status: "ok", match: prefix[0] };
  if (prefix.length > 1) return { status: "ambiguous", query, candidates: prefix };

  const substring = candidates.filter((c) => normalizeName(c.name).includes(q));
  if (substring.length === 1) return { status: "ok", match: substring[0] };
  if (substring.length > 1) return { status: "ambiguous", query, candidates: substring };

  return { status: "none", query };
}

/// The message a tool returns when resolution did not produce exactly one
/// match. Written for the model: it names the failure and states the next
/// move, rather than describing the problem and stopping.
///
/// `available` is capped because a user with a hundred clients would
/// otherwise push a hundred names into the context on every typo.
export function describeResolveFailure<T extends NamedEntity>(
  result: Exclude<ResolveResult<T>, { status: "ok" }>,
  entityLabel: string,
  available: T[]
): string {
  if (result.status === "ambiguous") {
    const names = result.candidates.map((c) => c.name).join(", ");
    return `"${result.query}" matches more than one ${entityLabel}: ${names}. Ask the user which one they meant and call this tool again with the exact name. Do not pick one yourself.`;
  }

  const shown = available.slice(0, 25).map((c) => c.name);
  const suffix = available.length > shown.length ? `, and ${available.length - shown.length} more` : "";
  if (shown.length === 0) {
    return `No ${entityLabel} named "${result.query}" is available to this user, and in fact they have access to none at all. Tell the user to ask an Ankora admin for access.`;
  }
  return `No ${entityLabel} named "${result.query}" is available to this user. The ones they can use are: ${shown.join(", ")}${suffix}. Ask the user which they meant - do not retry with a guess.`;
}
