import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { sourceFiles } from "../helpers/source-strings";
import { GENERATED, computeRouteMessages, renderGenerated } from "../../scripts/i18n/route-messages.mjs";
import { AREA_MESSAGE_PATHS, GLOBAL_MESSAGE_PATHS } from "@/lib/i18n/route-messages.generated";
import { pickMessages } from "@/lib/i18n/client-messages";
import he from "../../messages/he.json";

/**
 * ADR 0006, decision 7. The browser gets the shell's part of the dictionary
 * on every page and an area's part on that area's pages. Both lists are
 * worked out from the code; these tests keep them in step with it, because
 * a namespace missing from them shows up only in the browser, as a key
 * where a word should be.
 */
const AUTHED = "app/(product)/app/(authenticated)";
const HOOK = /useTranslations\(\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`|([^)\s][^)]*))?\s*\)/g;

describe("the dictionary each area sends to the browser (ADR 0006)", () => {
  it("is up to date with the code", () => {
    const fresh = renderGenerated(computeRouteMessages());
    expect(readFileSync(GENERATED, "utf8") === fresh, "run: node scripts/i18n/route-messages.mjs").toBe(true);
  });

  it("can only be worked out when every namespace is a plain string", () => {
    const dynamic = [...sourceFiles("app"), ...sourceFiles("components"), ...sourceFiles("lib")].flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(HOOK)].filter((m) => m[1] === undefined && m[2] === undefined).map(() => file),
    );
    expect(dynamic, "useTranslations() with no namespace or a computed one").toEqual([]);
  });

  it("is given by a layout in every area folder, named after the folder", () => {
    const missing = readdirSync(AUTHED)
      .filter((d) => statSync(join(AUTHED, d)).isDirectory())
      .filter((d) => {
        try {
          return !readFileSync(join(AUTHED, d, "layout.tsx"), "utf8").includes(`<ScopedMessages area="${d}">`);
        } catch {
          return true;
        }
      });
    expect(missing, `each needs a layout.tsx with <ScopedMessages area="<folder>">`).toEqual([]);
  });

  it("names parts that exist in the dictionary", () => {
    const all = [...GLOBAL_MESSAGE_PATHS, ...Object.values(AREA_MESSAGE_PATHS).flat()];
    const missing = all.filter((p) => p.split(".").reduce<unknown>((n, k) => (n as Record<string, unknown> | undefined)?.[k], he) === undefined);
    expect(missing).toEqual([]);
  });

  it("keeps what it picks whole and leaves the rest out", () => {
    expect(pickMessages({ a: { b: { x: "1" }, c: "2" }, d: "3" }, ["a.b"])).toEqual({ a: { b: { x: "1" } } });
    expect(pickMessages({ a: { b: "1", c: "2" } }, ["a.b", "a.c"])).toEqual({ a: { b: "1", c: "2" } });
  });
});
