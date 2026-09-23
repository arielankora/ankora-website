import { describe, expect, it } from "vitest";
import {
  DIGEST_LABELS,
  DOCUMENT_KIND_LABELS,
  SUPPLIER_EXPERIENCE_LABELS,
} from "@/lib/app-domain/portal-labels";

// Three label maps, and the only way they break is by omission: someone
// adds a value to a Prisma enum, nobody adds the Hebrew, and a client
// reads "undefined" in their own file.
//
// TypeScript catches a missing key on a Record<Enum, string> at compile
// time, which is most of the protection. What it cannot catch is a key
// present and empty, or one filled in with the enum name because the
// Hebrew had not been decided yet - both of which ship green.

const MAPS = {
  DIGEST_LABELS,
  DOCUMENT_KIND_LABELS,
  SUPPLIER_EXPERIENCE_LABELS,
} as const;

describe("portal label maps", () => {
  it("gives every value a non-empty Hebrew label", () => {
    const bad: string[] = [];

    for (const [mapName, map] of Object.entries(MAPS)) {
      for (const [key, label] of Object.entries(map)) {
        if (!label.trim()) bad.push(`${mapName}.${key} is empty`);
        // A label identical to its key is the enum name leaking to a
        // screen, which is what "TODO" looks like in production.
        if (label.trim() === key) bad.push(`${mapName}.${key} is still the enum name`);
        if (!/[֐-׿]/.test(label)) bad.push(`${mapName}.${key} has no Hebrew in it: ${label}`);
      }
    }

    expect(bad).toEqual([]);
  });
});
