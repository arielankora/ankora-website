import { describe, expect, it } from "vitest";
import { NO_CATEGORY, filterAgents, groupAgents } from "@/lib/agents/categories";

// Agents (24.11.2026): the agents screen's filter and grouping.

const agent = (id: string, categories: string[], clientIds: string[] = [], allClients = false) => ({ id, categories: categories.map((c) => ({ id: c })), clientIds, allClients });

const mail = agent("mail", ["internal", "ariel"], ["c1"]);
const client = agent("client", ["clients"], ["c2"]);
const loose = agent("loose", [], [], true);
const all = [mail, client, loose];

describe("filterAgents", () => {
  it("keeps everything with no filter", () => {
    expect(filterAgents(all, { categories: [], client: null })).toEqual(all);
  });

  it("keeps an agent in any of the chosen categories", () => {
    expect(filterAgents(all, { categories: ["ariel", "clients"], client: null }).map((a) => a.id)).toEqual(["mail", "client"]);
  });

  it("keeps the agents in no category for NO_CATEGORY, with or beside others", () => {
    expect(filterAgents(all, { categories: [NO_CATEGORY], client: null }).map((a) => a.id)).toEqual(["loose"]);
    expect(filterAgents(all, { categories: [NO_CATEGORY, "clients"], client: null }).map((a) => a.id)).toEqual(["client", "loose"]);
  });

  it("keeps an agent installed on the client, or on all its owner's clients", () => {
    expect(filterAgents(all, { categories: [], client: "c2" }).map((a) => a.id)).toEqual(["client", "loose"]);
  });

  it("applies the category and the client together", () => {
    expect(filterAgents(all, { categories: ["internal"], client: "c2" })).toEqual([]);
  });
});

describe("filterAgents: free search", () => {
  const named = [
    { ...agent("weekly", ["clients"]), name: "דוח שבועי ללקוח", purpose: "טיוטת דוח ב-Gmail", slug: "weekly-client-report" },
    { ...agent("usage", ["internal"]), name: "שימוש בקלוד: דוח שבועי", purpose: "קריאה בלבד", slug: "claude-usage-weekly" },
    { ...agent("mail", ["ariel"]), name: "סוכן מייל", purpose: "ממיין את תיבת המייל", slug: "mail-agent" },
  ];
  const ids = (query: string, extra: { categories?: string[] } = {}) => filterAgents(named, { categories: extra.categories ?? [], client: null, query }).map((a) => a.id);

  it("keeps an agent whose name, description or id holds every word, in any order", () => {
    expect(ids("דוח שבועי")).toEqual(["weekly", "usage"]);
    expect(ids("שבועי ללקוח")).toEqual(["weekly"]);
    expect(ids("gmail")).toEqual(["weekly"]);
    expect(ids("MAIL-agent")).toEqual(["mail"]);
    expect(ids("\"סוכן מייל\"")).toEqual(["mail"]);
  });

  it("an empty search keeps everything, and it works with the other filters", () => {
    expect(ids("  ")).toEqual(["weekly", "usage", "mail"]);
    expect(ids("דוח", { categories: ["internal"] })).toEqual(["usage"]);
    expect(ids("אין כזה")).toEqual([]);
  });
});

describe("groupAgents", () => {
  const categories = [
    { id: "clients", name: "לקוחות" },
    { id: "internal", name: "תפעול פנימי" },
    { id: "ariel", name: "אישי" },
    { id: "empty", name: "ריקה" },
  ];

  it("groups in the list's order, an agent in each of its categories, then the ones in none", () => {
    expect(groupAgents(all, categories).map((g) => [g.id, g.agents.map((a) => a.id)])).toEqual([
      ["clients", ["client"]],
      ["internal", ["mail"]],
      ["ariel", ["mail"]],
      [NO_CATEGORY, ["loose"]],
    ]);
  });

  it("leaves empty groups out, including the no-category one", () => {
    expect(groupAgents([mail], categories).map((g) => g.id)).toEqual(["internal", "ariel"]);
  });
});
