// The knowledge fields every item in the client file carries
// (claude/org-brain-spec-2026-10-12.md, section 3.1). Pure: no Prisma, so
// the rules are testable anywhere and a client component may import the
// labels.
//
// Two rules live here and nowhere else:
//
// 1. **An item is as strong as its weakest field.** NUX.AI Ltd is a
//    confirmed entity whose registration number is missing; the entity as
//    a whole reads "missing", because that is what anyone acting on it
//    needs to know first.
// 2. **Who may see an item** is decided by its audience, the person
//    asking, and whether they manage clients. The screens and MCP both
//    ask this function, so the two can never disagree.

export type KnowledgeStatusLike = "CONFIRMED" | "UNCERTAIN" | "MISSING" | "SUPERSEDED";
export type KnowledgeAudienceLike = "ALL_STAFF" | "ACCOUNT_TEAM" | "RESTRICTED";

export const KNOWLEDGE_STATUS_LABELS: Record<KnowledgeStatusLike, string> = {
  CONFIRMED: "מאושר",
  UNCERTAIN: "לא ודאי",
  MISSING: "חסר",
  SUPERSEDED: "הוחלף",
};

export const KNOWLEDGE_AUDIENCE_LABELS: Record<KnowledgeAudienceLike, string> = {
  ALL_STAFF: "כל מי שעובד על הלקוח",
  ACCOUNT_TEAM: "מנהל התיק ומי שנבחר",
  RESTRICTED: "רק מי שנבחר",
};

/// Strength, high to low. SUPERSEDED is not on the scale: a superseded
/// item is history, and its fields do not make it any more or less so.
const STRENGTH: Record<Exclude<KnowledgeStatusLike, "SUPERSEDED">, number> = {
  CONFIRMED: 3,
  UNCERTAIN: 2,
  MISSING: 1,
};

export type FieldStatusEntry = {
  status: "UNCERTAIN" | "MISSING";
  toResolve?: string;
  sources?: { code: string; at?: string }[];
};

export type FieldStatusMap = Record<string, FieldStatusEntry>;

/// Reads a stored `fieldStatus` value defensively. Anything that is not a
/// well-formed entry is dropped rather than trusted: this column is written
/// by people and, later, by proposals from Claude.
export function parseFieldStatus(value: unknown): FieldStatusMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: FieldStatusMap = {};
  for (const [field, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    if (entry.status !== "UNCERTAIN" && entry.status !== "MISSING") continue;
    out[field] = {
      status: entry.status,
      ...(typeof entry.toResolve === "string" && entry.toResolve.trim() ? { toResolve: entry.toResolve.trim() } : {}),
    };
  }
  return out;
}

/// Rule 1: the weakest of the item's own status and its fields' statuses.
export function effectiveStatus(itemStatus: KnowledgeStatusLike, fieldStatus: FieldStatusMap): KnowledgeStatusLike {
  if (itemStatus === "SUPERSEDED") return "SUPERSEDED";
  let weakest: Exclude<KnowledgeStatusLike, "SUPERSEDED"> = itemStatus;
  for (const entry of Object.values(fieldStatus)) {
    if (STRENGTH[entry.status] < STRENGTH[weakest]) weakest = entry.status;
  }
  return weakest;
}

/// Rule 2. `isManager` is canManageClients for the viewer's role;
/// `accountManagerId` is the client's.
export function canSeeKnowledgeItem(
  item: { audience: KnowledgeAudienceLike; audienceUserIds: string[] },
  viewer: { id: string; isManager: boolean },
  accountManagerId: string | null
): boolean {
  if (viewer.isManager) return true;
  if (item.audience === "ALL_STAFF") return true;
  if (item.audienceUserIds.includes(viewer.id)) return true;
  if (item.audience === "ACCOUNT_TEAM" && accountManagerId === viewer.id) return true;
  return false;
}
