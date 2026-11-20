// The versions a fact replaced (20.11.2026, Ariel): each current fact with
// the chain behind it, newest first, and what no current fact leads back
// to. A fact replaced by one that was replaced again is in the chain of
// the version in force.

export type VersionLike = { id: string; supersededById: string | null };

export function previousVersions<T extends VersionLike>(current: { id: string }[], superseded: T[], max = 20): { previous: Map<string, T[]>; orphans: T[] } {
  const replacedBy = new Map(superseded.filter((f) => f.supersededById).map((f) => [f.supersededById!, f]));
  const seen = new Set<string>();
  const previous = new Map<string, T[]>();
  for (const f of current) {
    const chain: T[] = [];
    for (let at = replacedBy.get(f.id); at && !seen.has(at.id) && chain.length < max; at = replacedBy.get(at.id)) {
      seen.add(at.id);
      chain.push(at);
    }
    previous.set(f.id, chain);
  }
  return { previous, orphans: superseded.filter((f) => !seen.has(f.id)) };
}
