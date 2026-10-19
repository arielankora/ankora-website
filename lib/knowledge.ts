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

/// Spec 3.1, per field: what may be marked missing on an item that is
/// otherwise known (an entity has its own list, in its form).
export const ITEM_MISSING_FIELDS = {
  CONTACT: { emails: "מייל", phones: "טלפון", role: "תפקיד", clientSideAddress: "כתובת אצל הלקוח" },
  SYSTEM: { url: "כתובת", accountUsed: "החשבון שלנו", clientAdmin: "מנהל אצל הלקוח", billing: "חיוב" },
} as const;
export type MissingFieldsTarget = keyof typeof ITEM_MISSING_FIELDS;

/// The fields marked missing, with what would close them. Unknown fields
/// are dropped; a mark without a reason gets "לברר", never nothing.
export function fieldStatusFrom(target: MissingFieldsTarget, missing: string[], toResolve: string | null | undefined): FieldStatusMap {
  const allowed = Object.keys(ITEM_MISSING_FIELDS[target]);
  const why = toResolve?.trim() || "לברר";
  const out: FieldStatusMap = {};
  for (const f of missing) if (allowed.includes(f)) out[f] = { status: "MISSING", toResolve: why };
  return out;
}

/// "חסר: מייל, טלפון · לבקש מגיא", or null.
export function missingLine(target: MissingFieldsTarget, value: unknown): string | null {
  const labels = ITEM_MISSING_FIELDS[target] as Record<string, string>;
  const entries = Object.entries(parseFieldStatus(value)).filter(([k, v]) => v.status === "MISSING" && labels[k]);
  if (!entries.length) return null;
  const why = entries[0][1].toResolve;
  return `חסר: ${entries.map(([k]) => labels[k]).join(", ")}${why ? ` · ${why}` : ""}`;
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

/// Rule 3: what may leave the product for Claude (spec 3.1, 6.1, 6.3),
/// asked on top of rule 2. A sensitive item never goes. A restricted item
/// goes only to someone named on it: a manager sees it on the screen, but
/// being able to see it is not being one of the people it was meant for,
/// and a Claude conversation is a copy outside the product.
export function canSendToAi(
  item: { sensitivity: string; audience: KnowledgeAudienceLike; audienceUserIds: string[] },
  viewerId: string
): boolean {
  if (item.sensitivity === "SENSITIVE") return false;
  if (item.audience === "RESTRICTED") return item.audienceUserIds.includes(viewerId);
  return true;
}

/// What may be shown to the client (spec 3.1): an item a person marked
/// "visible to the client", that every one of us may read, and that is
/// neither sensitive nor carries a "do not tell". Null when it may; why
/// not, otherwise. The portal will show only what passes this.
export function clientVisibleBlocker(item: { sensitivity?: string | null; audience?: KnowledgeAudienceLike | null; doNotDisclose?: string | null }): string | null {
  if (item.sensitivity === "SENSITIVE") return "פריט רגיש לא מוצג ללקוח.";
  if (item.audience && item.audience !== "ALL_STAFF") return "פריט שרק חלק מהצוות רואה לא מוצג ללקוח.";
  if (item.doNotDisclose?.trim()) return "לפריט יש \"לא לספר\", ולכן הוא לא מוצג ללקוח.";
  return null;
}

/// Rule 4: what may be written into a task. A task is read by everyone on
/// the client and goes to Claude whole ("קדם עם קלוד", get_task), so only
/// an item meant for all of them, and not sensitive, is copied into one.
export function canCopyIntoTask(item: { sensitivity: string; audience: KnowledgeAudienceLike }): boolean {
  return item.sensitivity !== "SENSITIVE" && item.audience === "ALL_STAFF";
}
