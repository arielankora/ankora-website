import { describe, expect, it } from "vitest";
import { FILE_SECTIONS, fileSectionLabel, resolveFileSection, sectionOfAnchor, showsSection } from "@/lib/client-file-parts";

// 31.10.2026: the client file in parts, with the long view kept as "הכול".

describe("client file parts", () => {
  it("takes the part in the address first, then the one last opened, then everything", () => {
    expect(resolveFileSection("processes", "rules")).toBe("processes");
    expect(resolveFileSection(undefined, "rules")).toBe("rules");
    expect(resolveFileSection(undefined, undefined)).toBe("all");
    expect(resolveFileSection("all", "rules")).toBe("all");
  });

  it("ignores a part it does not know", () => {
    expect(resolveFileSection("nonsense", "also-nonsense")).toBe("all");
    expect(resolveFileSection(["processes"], undefined)).toBe("all");
  });

  it("shows every part in the long view and one part otherwise", () => {
    for (const s of FILE_SECTIONS) expect(showsSection("all", s.key)).toBe(true);
    expect(showsSection("processes", "processes")).toBe(true);
    expect(showsSection("processes", "rules")).toBe(false);
  });

  it("opens the part an anchor names, and the whole file for any other", () => {
    expect(sectionOfAnchor("processes")).toBe("processes");
    expect(sectionOfAnchor("rules")).toBe("rules");
    expect(sectionOfAnchor("client-pending")).toBe("pending");
    expect(sectionOfAnchor("client-questions")).toBe("facts");
    expect(sectionOfAnchor("item-abc")).toBe("all");
    expect(fileSectionLabel("all")).toBe("הכול");
    expect(fileSectionLabel("processes")).toBe("תהליכים ונהלים");
    expect(FILE_SECTIONS[0]).toEqual({ key: "pending", label: "ממתין לאישור" });
  });
});
