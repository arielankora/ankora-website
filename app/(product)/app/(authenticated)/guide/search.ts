import type { GuideGroup, GuideSection } from "./content";

// The guide's search, as plain functions so it can be tested without a
// browser.
//
// Ariel, 26.9.2026: "להוסיף יכולת חיפוש במדריך שימוש". The guide is
// forty-odd sections long and the only way in was the table of contents,
// which only works if you already know what the screen is called.

/// The words of a query, lowercased. Hebrew has no case, but the guide is
/// full of English names (Claude, KPI, CSV) that people type either way.
export function queryWords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0);
}

/// Everything a section says, as one lowercased string.
function sectionText(section: GuideSection, groupTitle: string): string {
  return [
    groupTitle,
    section.title,
    section.summary,
    ...section.description,
    ...(section.steps ?? []),
    ...(section.notes ?? []),
    ...(section.images ?? []).map((i) => i.caption),
  ]
    .join("\n")
    .toLowerCase();
}

/// A section matches when EVERY word appears somewhere in it, not
/// necessarily together. "משימה אחראי" should find the section that
/// explains how to pick one, even though the two words are sentences
/// apart.
export function sectionMatches(section: GuideSection, groupTitle: string, words: string[]): boolean {
  if (words.length === 0) return true;
  const text = sectionText(section, groupTitle);
  return words.every((w) => text.includes(w));
}

/// The groups filtered to matching sections, with empty groups dropped.
export function filterGuide(groups: GuideGroup[], query: string): GuideGroup[] {
  const words = queryWords(query);
  if (words.length === 0) return groups;
  return groups
    .map((g) => ({ ...g, sections: g.sections.filter((s) => sectionMatches(s, g.title, words)) }))
    .filter((g) => g.sections.length > 0);
}

/// Splits text into plain and matched pieces, for highlighting. Longest
/// words first, so "משימות" is marked whole rather than as "משימה" + "ות".
export function highlightParts(text: string, words: string[]): { text: string; match: boolean }[] {
  if (words.length === 0 || !text) return [{ text, match: false }];
  const escaped = [...words]
    .sort((a, b) => b.length - a.length)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(${escaped.join("|")})`, "gi");
  return text
    .split(re)
    .filter((part) => part.length > 0)
    .map((part) => ({ text: part, match: words.includes(part.toLowerCase()) }));
}
