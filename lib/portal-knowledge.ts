// The client file, as the client sees it in the portal (claude/org-brain-
// spec-2026-10-12.md, 3.1 and section 7 of the 18.10 list).
//
// Only what someone at Ankora marked "visible to the client", and only
// what may be shown at all (clientVisibleBlocker: not sensitive, read by
// all of us, nothing "not to tell"). Checked twice: in the query, and here,
// so a row that slipped past the query is still not shown.
//
// What the client reads is their own world in their own words, never our
// working notes: no source codes, no "what would close it", no internal
// flags, no account names. An item we are not sure of says so, and asks
// them to confirm: that is how the portal makes the file better.
//
// Pure, so the screen and the tests read the same groups.

import { clientVisibleBlocker } from "@/lib/knowledge";
import { FACT_KIND_LABELS, type FactKindLike } from "@/lib/client-facts";

type Knowledge = {
  clientVisible: boolean;
  knowledgeStatus: string;
  sensitivity: string;
  audience: "ALL_STAFF" | "ACCOUNT_TEAM" | "RESTRICTED";
  doNotDisclose: string | null;
};

export type PortalKnowledgeInput = {
  processes: (Knowledge & { code: string; title: string; purpose: string | null; transitionStatus: string; status: string; nextDate: Date | null })[];
  policies: (Knowledge & { title: string; statement: string; status: string; effectiveFrom: Date | null })[];
  requestTypes: (Knowledge & { title: string; handling: string | null })[];
  systems: (Knowledge & { systemName: string; purpose: string | null; accessStatus: string })[];
  facts: (Knowledge & { kind: string; body: string; closedAt: Date | null })[];
  contacts: (Knowledge & { name: string | null; role: string | null })[];
  organizations: (Knowledge & { name: string; role: string | null })[];
  entities: (Knowledge & { name: string; legalName: string | null; country: string | null })[];
};

export type PortalKnowledgeItem = { text: string; detail?: string | null; tag?: string | null; askToConfirm?: boolean };
export type PortalKnowledgeGroup = { key: string; title: string; subtitle: string; items: PortalKnowledgeItem[] };

/// Whether the client may see this row. Both gates: the box someone
/// ticked, and the rules that override them.
export function shownToClient(r: Knowledge): boolean {
  if (!r.clientVisible) return false;
  if (r.knowledgeStatus === "SUPERSEDED") return false;
  return clientVisibleBlocker(r) === null;
}

/// Where a process stands, in the client's words.
export const HANDOVER_FOR_CLIENT: Record<string, string> = {
  WITH_CLIENT: "עדיין אצלך",
  IN_HANDOVER: "בחפיפה אלינו",
  WITH_ANKORA: "אצלנו",
  NOT_PLANNED: "נשאר אצלך",
};

export const ACCESS_FOR_CLIENT: Record<string, string | null> = {
  HAS_ACCESS: "יש לנו גישה",
  PENDING: "ממתינים לגישה",
  NO_ACCESS: "אין לנו גישה",
  NOT_NEEDED: null,
};

const dayLabel = (d: Date) => new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric", year: "numeric", timeZone: "Asia/Jerusalem" }).format(d);

const unsure = (r: Knowledge) => r.knowledgeStatus === "UNCERTAIN" || r.knowledgeStatus === "MISSING";

export function portalKnowledge(input: PortalKnowledgeInput, now: Date = new Date()): PortalKnowledgeGroup[] {
  const groups: PortalKnowledgeGroup[] = [
    {
      key: "processes",
      title: "מה אנחנו מנהלים עבורך",
      subtitle: "התהליכים שחוזרים אצלך, ואיפה כל אחד עומד.",
      items: input.processes
        .filter((p) => p.status !== "RETIRED" && shownToClient(p))
        .map((p) => ({
          text: p.title,
          detail: [p.purpose, p.nextDate && p.nextDate.getTime() >= now.getTime() ? `הבא: ${dayLabel(p.nextDate)}` : null].filter(Boolean).join(" · ") || null,
          tag: HANDOVER_FOR_CLIENT[p.transitionStatus] ?? null,
          askToConfirm: unsure(p),
        })),
    },
    {
      key: "rules",
      title: "כללים שקבעת",
      subtitle: "איך ביקשת שנעבוד. אנחנו בודקים כל נוהל מולם.",
      items: input.policies
        .filter((r) => r.status !== "RETIRED" && shownToClient(r))
        .map((r) => ({
          text: `${r.title}: ${r.statement}`,
          detail: r.effectiveFrom && r.effectiveFrom.getTime() > now.getTime() ? `מ-${dayLabel(r.effectiveFrom)}` : null,
          tag: r.status === "PROPOSED" ? "בהטמעה אצלנו" : null,
          askToConfirm: unsure(r),
        })),
    },
    {
      key: "requests",
      title: "איך פונים אלינו",
      subtitle: "מה מגיע אלינו, ומה קורה איתו.",
      items: input.requestTypes.filter(shownToClient).map((t) => ({ text: t.title, detail: t.handling, askToConfirm: unsure(t) })),
    },
    {
      key: "systems",
      title: "מערכות",
      subtitle: "המערכות שאנחנו עובדים בהן עבורך.",
      items: input.systems.filter(shownToClient).map((s) => ({ text: s.systemName, detail: s.purpose, tag: ACCESS_FOR_CLIENT[s.accessStatus] ?? null, askToConfirm: unsure(s) })),
    },
    {
      key: "facts",
      title: "מה ידוע לנו",
      subtitle: "העדפות, דרישות ודברים שחשוב שנזכור.",
      items: input.facts
        .filter((f) => f.kind !== "QUESTION" && !f.closedAt && shownToClient(f))
        .map((f) => ({ text: f.body, tag: FACT_KIND_LABELS[f.kind as FactKindLike] ?? null, askToConfirm: unsure(f) })),
    },
    {
      key: "people",
      title: "אנשים וגורמים",
      subtitle: "מי מעורב, ובמה.",
      items: [
        ...input.contacts.filter(shownToClient).map((c) => ({ text: c.name ?? c.role ?? "", detail: c.name ? c.role : null, askToConfirm: unsure(c) })),
        ...input.organizations.filter(shownToClient).map((o) => ({ text: o.name, detail: o.role, askToConfirm: unsure(o) })),
      ].filter((i) => i.text),
    },
    {
      key: "entities",
      title: "ישויות",
      subtitle: "החברות שעבורן אנחנו עובדים.",
      items: input.entities.filter(shownToClient).map((e) => ({ text: e.name, detail: [e.legalName, e.country].filter(Boolean).join(" · ") || null, askToConfirm: unsure(e) })),
    },
  ];
  // An empty group is not shown: the screen is for what is there.
  return groups.filter((g) => g.items.length > 0);
}
