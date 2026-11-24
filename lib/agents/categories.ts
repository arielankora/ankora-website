// Agents (24.11.2026): the agents screen's filter and grouping, apart from
// the screen so they can be tested on their own.

/// The filter value for the agents in no category.
export const NO_CATEGORY = "none";

type Filterable = { categories: { id: string }[]; clientIds: string[]; allClients: boolean };

/// Keeps an agent in any of the chosen categories (or in none, for
/// NO_CATEGORY), and, when a client is chosen, one with an installation on
/// it. An installation on all its owner's clients counts for every client.
export function filterAgents<A extends Filterable>(agents: A[], filter: { categories: string[]; client: string | null }): A[] {
  return agents.filter((a) => {
    if (filter.categories.length > 0) {
      const inChosen = a.categories.some((c) => filter.categories.includes(c.id));
      const inNone = filter.categories.includes(NO_CATEGORY) && a.categories.length === 0;
      if (!inChosen && !inNone) return false;
    }
    if (filter.client && !a.allClients && !a.clientIds.includes(filter.client)) return false;
    return true;
  });
}

/// One group per category, in the list's order, with every agent in it (an
/// agent in two categories is in both), then the agents in none. Empty
/// groups are left out.
export function groupAgents<A extends Filterable>(agents: A[], categories: { id: string; name: string }[]) {
  const groups: { id: string; name: string | null; agents: A[] }[] = categories.map((c) => ({ id: c.id, name: c.name, agents: agents.filter((a) => a.categories.some((x) => x.id === c.id)) }));
  groups.push({ id: NO_CATEGORY, name: null, agents: agents.filter((a) => a.categories.length === 0) });
  return groups.filter((g) => g.agents.length > 0);
}
