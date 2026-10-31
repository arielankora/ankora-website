// The client file in parts (task "תיק לקוח לפי חלקים", 31.10.2026): the
// file tab keeps its one long view ("הכול"), and beside it an index of
// parts that shows one part alone. The part last opened comes back, by a
// cookie, so whoever works on processes returns to them. Pure, so the page,
// the index and the tests agree on what a part holds.

export const FILE_SECTIONS = [
  { key: "pending", label: "ממתין לאישור" },
  { key: "overview", label: "סקירה וישויות" },
  { key: "people", label: "אנשים וספקים" },
  { key: "facts", label: "עובדות ושאלות" },
  { key: "processes", label: "תהליכים ונהלים" },
  { key: "rules", label: "כללים" },
  { key: "requests", label: "סוגי פניות" },
  { key: "systems", label: "מערכות וגישות" },
  { key: "sources", label: "מקורות" },
] as const;

export type FileSectionKey = (typeof FILE_SECTIONS)[number]["key"];
export type FileSection = FileSectionKey | "all";

export const FILE_SECTION_COOKIE = "ankora-file-section";
export const ALL_LABEL = "הכול";

const KEYS = new Set<string>(FILE_SECTIONS.map((s) => s.key));

function parse(v: unknown): FileSection | null {
  if (typeof v !== "string") return null;
  if (v === "all") return "all";
  return KEYS.has(v) ? (v as FileSectionKey) : null;
}

/// What the file shows: the part in the address first (a link or a
/// bookmark), then the part last opened, then everything.
export function resolveFileSection(param: unknown, cookie: unknown): FileSection {
  return parse(param) ?? parse(cookie) ?? "all";
}

export function showsSection(current: FileSection, key: FileSectionKey): boolean {
  return current === "all" || current === key;
}

/// The part an anchor in the file belongs to, when it names one; any other
/// anchor (an item, the pending batch) is found in the whole file.
export function sectionOfAnchor(anchor: string): FileSection {
  if (anchor === "processes") return "processes";
  if (anchor === "rules") return "rules";
  if (anchor === "client-pending") return "pending";
  return "all";
}

export function fileSectionLabel(s: FileSection): string {
  return s === "all" ? ALL_LABEL : FILE_SECTIONS.find((x) => x.key === s)!.label;
}
