import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { sourceFiles } from "../helpers/source-strings";
import { CLIENT_MESSAGE_PATHS, pickMessages } from "@/lib/i18n/client-messages";
import he from "../../messages/he.json";

/**
 * ADR 0006. The browser gets only the namespaces listed in
 * lib/i18n/client-messages.ts. A component that reads a namespace with the
 * `useTranslations` hook may run in the browser, so every such namespace
 * must be covered; otherwise the screen shows a key instead of a word, and
 * only in the browser, after hydration, where no server test sees it.
 */
const HOOK = /useTranslations\(\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`|([^)\s][^)]*))?\s*\)/g;

const uses = [...sourceFiles("app"), ...sourceFiles("components"), ...sourceFiles("lib")].flatMap((file) =>
  [...readFileSync(file, "utf8").matchAll(HOOK)].map((m) => ({
    file,
    ns: m[1] ?? m[2] ?? (m[3] !== undefined ? `\`${m[3]}\`` : m[4] !== undefined ? `<${m[4].trim()}>` : ""),
  })),
);

const covers = (path: string, ns: string) => ns === path || ns.startsWith(`${path}.`);

describe("the dictionary the browser gets (ADR 0006)", () => {
  it("names every namespace as a plain string, so it can be checked", () => {
    const dynamic = uses.filter((u) => u.ns === "" || u.ns.startsWith("<") || u.ns.startsWith("`")).map((u) => `${u.file}: useTranslations(${u.ns})`);
    expect(dynamic, "useTranslations() with no namespace or a computed one would need the whole dictionary").toEqual([]);
  });

  it("covers every namespace a component reads with the hook", () => {
    const missing = uses.filter((u) => !CLIENT_MESSAGE_PATHS.some((p) => covers(p, u.ns))).map((u) => `${u.file}: "${u.ns}"`);
    expect(missing, "add these to CLIENT_MESSAGE_PATHS in lib/i18n/client-messages.ts").toEqual([]);
  });

  it("lists nothing that no component reads any more", () => {
    const unused = CLIENT_MESSAGE_PATHS.filter((p) => !uses.some((u) => covers(p, u.ns)));
    expect(unused).toEqual([]);
  });

  it("names paths that exist in the dictionary", () => {
    const picked = pickMessages(he) as Record<string, unknown>;
    const missing = CLIENT_MESSAGE_PATHS.filter((p) => p.split(".").reduce<unknown>((n, k) => (n as Record<string, unknown> | undefined)?.[k], picked) === undefined);
    expect(missing).toEqual([]);
  });

  it("keeps what it picks whole and leaves the rest out", () => {
    const picked = pickMessages({ a: { b: { x: "1" }, c: "2" }, d: "3" }, ["a.b"]);
    expect(picked).toEqual({ a: { b: { x: "1" } } });
  });
});
