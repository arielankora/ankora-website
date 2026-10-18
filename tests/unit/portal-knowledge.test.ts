import { describe, expect, it } from "vitest";
import { portalKnowledge, shownToClient, type PortalKnowledgeInput } from "@/lib/portal-knowledge";

// The client file in the portal: only what was marked visible and may be
// shown, in the client's words, and an uncertain item asks to be confirmed.

const ok = { clientVisible: true, knowledgeStatus: "CONFIRMED", sensitivity: "NORMAL", audience: "ALL_STAFF" as const, doNotDisclose: null };
const empty: PortalKnowledgeInput = { processes: [], policies: [], requestTypes: [], systems: [], facts: [], contacts: [], organizations: [], entities: [] };
const now = new Date("2026-10-18T09:00:00Z");

describe("what the client sees", () => {
  it("only what was marked, and never what the rules forbid, even if marked", () => {
    expect(shownToClient(ok)).toBe(true);
    expect(shownToClient({ ...ok, clientVisible: false })).toBe(false);
    expect(shownToClient({ ...ok, sensitivity: "SENSITIVE" })).toBe(false);
    expect(shownToClient({ ...ok, audience: "RESTRICTED" })).toBe(false);
    expect(shownToClient({ ...ok, doNotDisclose: "לא לספר לאורן" })).toBe(false);
    expect(shownToClient({ ...ok, knowledgeStatus: "SUPERSEDED" })).toBe(false);
  });

  it("groups in the client's words, leaves out empty groups, and asks to confirm what we are not sure of", () => {
    const g = portalKnowledge(
      {
        ...empty,
        processes: [
          { ...ok, code: "P1", title: "תשלומי ספקים", purpose: "פעמיים בחודש", transitionStatus: "IN_HANDOVER", status: "ACTIVE", nextDate: new Date("2026-11-10T00:00:00Z") },
          { ...ok, code: "P2", title: "ישן", purpose: null, transitionStatus: "WITH_ANKORA", status: "RETIRED", nextDate: null },
        ],
        systems: [
          { ...ok, systemName: "Mercury", purpose: "בנק", accessStatus: "PENDING", knowledgeStatus: "UNCERTAIN" },
          { ...ok, systemName: "Rippling", purpose: null, accessStatus: "HAS_ACCESS", clientVisible: false },
        ],
        facts: [
          { ...ok, kind: "PREFERENCE", body: "WhatsApp קודם", closedAt: null },
          { ...ok, kind: "QUESTION", body: "מי מורשה החתימה?", closedAt: null },
        ],
      },
      now
    );
    expect(g.map((x) => x.key)).toEqual(["processes", "systems", "facts"]);
    expect(g[0].items).toEqual([{ text: "תשלומי ספקים", detail: "פעמיים בחודש · הבא: 10.11.2026", tag: "בחפיפה אלינו", askToConfirm: false }]);
    expect(g[1].items).toEqual([{ text: "Mercury", detail: "בנק", tag: "ממתינים לגישה", askToConfirm: true }]);
    expect(g[2].items).toEqual([{ text: "WhatsApp קודם", tag: "העדפה", askToConfirm: false }]);
  });

  it("nothing marked, nothing shown", () => {
    expect(portalKnowledge(empty, now)).toEqual([]);
  });
});
